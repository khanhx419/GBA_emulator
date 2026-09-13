import { SCREEN, IO, IRQ } from './gba-constants.js';

export class GBAPPU {
  constructor(gba) {
    this.gba = gba;

    // Display Registers
    this.dispcnt = 0x0080; // Forced blank initially
    this.dispstat = 0;
    this.vcount = 0;

    // Backgrounds 0-3
    this.bg = [
      { cnt: 0, x: 0, y: 0, pa: 256, pb: 0, pc: 0, pd: 256, refX: 0, refY: 0, curX: 0, curY: 0 },
      { cnt: 0, x: 0, y: 0, pa: 256, pb: 0, pc: 0, pd: 256, refX: 0, refY: 0, curX: 0, curY: 0 },
      { cnt: 0, x: 0, y: 0, pa: 256, pb: 0, pc: 0, pd: 256, refX: 0, refY: 0, curX: 0, curY: 0 },
      { cnt: 0, x: 0, y: 0, pa: 256, pb: 0, pc: 0, pd: 256, refX: 0, refY: 0, curX: 0, curY: 0 }
    ];

    // Windows
    this.win0h = 0; this.win1h = 0;
    this.win0v = 0; this.win1v = 0;
    this.winIn = 0; this.winOut = 0;

    // Color effects
    this.mosaic = 0;
    this.bldCnt = 0;
    this.bldAlpha = 0;
    this.bldY = 0;

    // Framebuffer: 240 x 160 x 4 (RGBA)
    this.framebuffer = new Uint32Array(SCREEN.WIDTH * SCREEN.HEIGHT);
    this.lineBuffer = new Uint32Array(SCREEN.WIDTH);
    this.layerBuffer = [
      new Uint32Array(SCREEN.WIDTH),
      new Uint32Array(SCREEN.WIDTH),
      new Uint32Array(SCREEN.WIDTH),
      new Uint32Array(SCREEN.WIDTH),
      new Uint32Array(SCREEN.WIDTH) // Sprites (OBJ)
    ];
    this.layerPriority = new Int32Array(5);

    this.cyclesInScanline = 0;

    // === OPTIMIZATION: Pre-computed color LUT (32768 entries) ===
    this.colorLUT = new Uint32Array(32768);
    this._buildColorLUT();
  }

  /** Pre-build RGB15 → RGBA32 lookup table */
  _buildColorLUT() {
    for (let c = 0; c < 32768; c++) {
      const r = (c & 0x1F) << 3;
      const g = ((c >> 5) & 0x1F) << 3;
      const b = ((c >> 10) & 0x1F) << 3;
      this.colorLUT[c] = (0xFF << 24) | (b << 16) | (g << 8) | r;
    }
  }

  reset() {
    this.dispcnt = 0x0080;
    this.dispstat = 0;
    this.vcount = 0;
    this.cyclesInScanline = 0;
    this.framebuffer.fill(0xFF000000);
  }

  readDISPCNT() { return this.dispcnt; }
  writeDISPCNT(val) { this.dispcnt = val & 0xFFF7; }

  readDISPSTAT() {
    let stat = this.dispstat & 0xFFF8;
    if (this.vcount >= SCREEN.HEIGHT && this.vcount < SCREEN.TOTAL_SCANLINES - 1) {
      stat |= 0x0001; // VBlank flag
    }
    if (this.cyclesInScanline >= 1006) {
      stat |= 0x0002; // HBlank flag
    }
    const vcountTarget = (this.dispstat >> 8) & 0xFF;
    if (this.vcount === vcountTarget) {
      stat |= 0x0004; // VCounter match
    }
    return stat;
  }

  writeDISPSTAT(val) {
    this.dispstat = (this.dispstat & 0x0007) | (val & 0xFFF8);
  }

  step(cycles) {
    this.cyclesInScanline += cycles;

    // Check HBlank (at cycle 1006 of 1232)
    if (this.cyclesInScanline >= 1006 && (this.cyclesInScanline - cycles) < 1006) {
      if (this.vcount < SCREEN.HEIGHT) {
        // Trigger HBlank DMA & IRQ
        this.gba.dma.trigger(2); // HBlank DMA
        if (this.dispstat & 0x0010) {
          this.gba.interrupts.raise(IRQ.HBLANK);
        }
      }
    }

    if (this.cyclesInScanline >= SCREEN.CYCLES_PER_SCANLINE) {
      this.cyclesInScanline -= SCREEN.CYCLES_PER_SCANLINE;
      this.endScanline();
    }
  }

  endScanline() {
    // Render visible scanline
    if (this.vcount < SCREEN.HEIGHT) {
      this.renderScanline(this.vcount);
    }

    this.vcount++;

    // Check VCounter Match IRQ
    const vcountTarget = (this.dispstat >> 8) & 0xFF;
    if (this.vcount === vcountTarget && (this.dispstat & 0x0020)) {
      this.gba.interrupts.raise(IRQ.VCOUNTER);
    }

    // Entering VBlank (scanline 160)
    if (this.vcount === SCREEN.HEIGHT) {
      // Trigger VBlank DMA & IRQ
      this.gba.dma.trigger(1); // VBlank DMA
      if (this.dispstat & 0x0008) {
        this.gba.interrupts.raise(IRQ.VBLANK);
      }
      // On VBlank, copy framebuffer to screen
      this.gba.onFrameComplete(this.framebuffer);
    }

    // Reset scanline at 228
    if (this.vcount >= SCREEN.TOTAL_SCANLINES) {
      this.vcount = 0;
      // Reset affine reference points at start of frame
      for (let i = 2; i <= 3; i++) {
        this.bg[i].curX = this.bg[i].refX;
        this.bg[i].curY = this.bg[i].refY;
      }
    } else if (this.vcount < SCREEN.HEIGHT) {
      // Advance affine reference points per scanline
      for (let i = 2; i <= 3; i++) {
        this.bg[i].curX += this.bg[i].pb;
        this.bg[i].curY += this.bg[i].pd;
      }
    }
  }

  renderScanline(line) {
    if (this.dispcnt & 0x0080) {
      // Forced Blank - render white
      const lineStart = line * SCREEN.WIDTH;
      this.framebuffer.fill(0xFFFFFFFF, lineStart, lineStart + SCREEN.WIDTH);
      return;
    }

    const mode = this.dispcnt & 0x07;
    const mmu = this.gba.mmu;
    const lineStart = line * SCREEN.WIDTH;

    // === OPTIMIZATION: Direct typed array references ===
    const palette16 = new Uint16Array(mmu.palette.buffer);
    const vram8 = mmu.vram;
    const vram16 = new Uint16Array(mmu.vram.buffer);
    const oam16 = new Uint16Array(mmu.oam.buffer);
    const colorLUT = this.colorLUT;

    // Clear line buffers (0 = transparent)
    for (let i = 0; i < 5; i++) {
      this.layerBuffer[i].fill(0);
    }

    // Backdrop color (Palette 0) — direct array access
    const backdropColor = colorLUT[palette16[0] & 0x7FFF];

    // Render Mode 0, 1, 2, 3, 4, 5
    if (mode === 0) {
      for (let i = 0; i < 4; i++) {
        if (this.dispcnt & (1 << (8 + i))) {
          this.renderTextBG_fast(i, line, vram8, vram16, palette16, colorLUT);
        }
      }
    } else if (mode === 1) {
      if (this.dispcnt & 0x0100) this.renderTextBG_fast(0, line, vram8, vram16, palette16, colorLUT);
      if (this.dispcnt & 0x0200) this.renderTextBG_fast(1, line, vram8, vram16, palette16, colorLUT);
      if (this.dispcnt & 0x0400) this.renderAffineBG_fast(2, line, vram8, palette16, colorLUT);
    } else if (mode === 2) {
      if (this.dispcnt & 0x0400) this.renderAffineBG_fast(2, line, vram8, palette16, colorLUT);
      if (this.dispcnt & 0x0800) this.renderAffineBG_fast(3, line, vram8, palette16, colorLUT);
    } else if (mode === 3) {
      // Bitmap 240x160 16-bit direct color
      if (this.dispcnt & 0x0400) {
        const vramOffset = line * 240;
        const lb = this.layerBuffer[2];
        for (let x = 0; x < 240; x++) {
          lb[x] = colorLUT[vram16[vramOffset + x] & 0x7FFF];
        }
      }
    } else if (mode === 4) {
      // Bitmap 240x160 8-bit palette indexed
      if (this.dispcnt & 0x0400) {
        const page = (this.dispcnt & 0x0010) ? 0xA000 : 0x0000;
        const vramOffset = page + line * 240;
        const lb = this.layerBuffer[2];
        for (let x = 0; x < 240; x++) {
          const palIdx = vram8[vramOffset + x];
          if (palIdx !== 0) {
            lb[x] = colorLUT[palette16[palIdx] & 0x7FFF];
          }
        }
      }
    }

    // Render Sprites (OBJ)
    if (this.dispcnt & 0x1000) {
      this.renderSprites_fast(line, vram8, palette16, oam16, colorLUT);
    }

    // Compose layers with Priority and Backdrop
    const fb = this.framebuffer;
    const lb0 = this.layerBuffer[0];
    const lb1 = this.layerBuffer[1];
    const lb2 = this.layerBuffer[2];
    const lb3 = this.layerBuffer[3];
    const lb4 = this.layerBuffer[4];
    const dc = this.dispcnt;
    const bgCnt0 = this.bg[0].cnt & 3;
    const bgCnt1 = this.bg[1].cnt & 3;
    const bgCnt2 = this.bg[2].cnt & 3;
    const bgCnt3 = this.bg[3].cnt & 3;
    const bg0On = (dc & 0x0100) !== 0;
    const bg1On = (dc & 0x0200) !== 0;
    const bg2On = (dc & 0x0400) !== 0;
    const bg3On = (dc & 0x0800) !== 0;

    for (let x = 0; x < SCREEN.WIDTH; x++) {
      let finalColor = backdropColor;

      // Check layers in priority order (3 down to 0)
      for (let prio = 3; prio >= 0; prio--) {
        if (bg3On && bgCnt3 === prio) { const c = lb3[x]; if (c !== 0) finalColor = c; }
        if (bg2On && bgCnt2 === prio) { const c = lb2[x]; if (c !== 0) finalColor = c; }
        if (bg1On && bgCnt1 === prio) { const c = lb1[x]; if (c !== 0) finalColor = c; }
        if (bg0On && bgCnt0 === prio) { const c = lb0[x]; if (c !== 0) finalColor = c; }

        // Check OBJ
        const objCol = lb4[x];
        if (objCol !== 0 && (objCol >>> 24) === (prio + 1)) {
          finalColor = (objCol & 0x00FFFFFF) | 0xFF000000;
        }
      }

      fb[lineStart + x] = finalColor;
    }
  }

  /** Optimized text BG renderer with direct memory access */
  renderTextBG_fast(bgIdx, line, vram8, vram16, palette16, colorLUT) {
    const bg = this.bg[bgIdx];
    const cnt = bg.cnt;
    const lb = this.layerBuffer[bgIdx];

    const charBase = ((cnt >> 2) & 3) * 0x4000;
    const is256Color = (cnt & 0x80) !== 0;
    const screenBase = ((cnt >> 8) & 0x1F) * 0x800;
    const screenSize = (cnt >> 14) & 3;

    let width = 256, height = 256;
    if (screenSize === 1) width = 512;
    else if (screenSize === 2) height = 512;
    else if (screenSize === 3) { width = 512; height = 512; }

    const scrollX = bg.x;
    const scrollY = (bg.y + line) % height;
    const tileY = (scrollY >> 3);
    const inTileY = scrollY & 7;

    // Pre-compute map base adjustments for vertical scroll
    let mapBaseY = screenBase;
    if (height === 512 && scrollY >= 256) mapBaseY += (width === 512 ? 0x1000 : 0x800);

    for (let x = 0; x < SCREEN.WIDTH; x++) {
      const curX = (scrollX + x) % width;
      const tileX = (curX >> 3);
      const inTileX = curX & 7;

      let mapBase = mapBaseY;
      if (width === 512 && curX >= 256) mapBase += 0x800;

      const mapOffset = mapBase + ((tileY & 31) * 32 + (tileX & 31));
      const tileEntry = vram16[mapOffset];

      const tileNum = tileEntry & 0x3FF;
      const hFlip = (tileEntry & 0x0400) !== 0;
      const vFlip = (tileEntry & 0x0800) !== 0;

      const px = hFlip ? (7 - inTileX) : inTileX;
      const py = vFlip ? (7 - inTileY) : inTileY;

      if (is256Color) {
        const charOffset = charBase + tileNum * 64 + py * 8 + px;
        const palIdx = vram8[charOffset];
        if (palIdx !== 0) {
          lb[x] = colorLUT[palette16[palIdx] & 0x7FFF];
        }
      } else {
        const palGroup = (tileEntry >> 12) & 0xF;
        const charOffset = charBase + tileNum * 32 + py * 4 + (px >> 1);
        const byteVal = vram8[charOffset];
        const palIdx = (px & 1) ? (byteVal >> 4) : (byteVal & 0x0F);
        if (palIdx !== 0) {
          lb[x] = colorLUT[palette16[palGroup * 16 + palIdx] & 0x7FFF];
        }
      }
    }
  }

  /** Optimized affine BG renderer with direct memory access */
  renderAffineBG_fast(bgIdx, line, vram8, palette16, colorLUT) {
    const bg = this.bg[bgIdx];
    const cnt = bg.cnt;
    const lb = this.layerBuffer[bgIdx];

    const charBase = ((cnt >> 2) & 3) * 0x4000;
    const screenBase = ((cnt >> 8) & 0x1F) * 0x800;
    const sizeShift = 7 + ((cnt >> 14) & 3);
    const size = 1 << sizeShift;
    const wrap = (cnt & 0x2000) !== 0;
    const sizeMask = size - 1;

    let xVal = bg.curX;
    let yVal = bg.curY;
    const pa = bg.pa;
    const pc = bg.pc;

    for (let x = 0; x < SCREEN.WIDTH; x++) {
      let px = xVal >> 8;
      let py = yVal >> 8;

      xVal += pa;
      yVal += pc;

      if (wrap) {
        px = px & sizeMask;
        py = py & sizeMask;
      } else if (px < 0 || px >= size || py < 0 || py >= size) {
        continue;
      }

      const tileX = px >> 3;
      const tileY = py >> 3;
      const inTileX = px & 7;
      const inTileY = py & 7;

      const tilesPerRow = size >> 3;
      const mapOffset = screenBase + (tileY * tilesPerRow + tileX);
      const tileNum = vram8[mapOffset];

      const charOffset = charBase + tileNum * 64 + inTileY * 8 + inTileX;
      const palIdx = vram8[charOffset];
      if (palIdx !== 0) {
        lb[x] = colorLUT[palette16[palIdx] & 0x7FFF];
      }
    }
  }

  /** Optimized sprite renderer with direct memory access and early culling */
  renderSprites_fast(line, vram8, palette16, oam16, colorLUT) {
    const is1DMapping = (this.dispcnt & 0x0040) !== 0;
    const lb = this.layerBuffer[4];

    const SIZES = [
      [[8,8],[16,16],[32,32],[64,64]],
      [[16,8],[32,8],[32,16],[64,32]],
      [[8,16],[8,32],[16,32],[32,64]]
    ];

    // OBJ sprite VRAM starts at 0x10000 in VRAM
    const sprVram = vram8;
    const sprVramBase = 0x10000;
    // OBJ palette at palette[256..511] = index 128..255 in 16-bit array
    const objPal16Offset = 256; // 0x200 / 2

    // Scan all 128 OAM entries (reverse for priority)
    for (let i = 127; i >= 0; i--) {
      const oamBase = i * 4; // 4 x uint16 per entry
      const attr0 = oam16[oamBase];
      const attr1 = oam16[oamBase + 1];
      const attr2 = oam16[oamBase + 2];

      const isRotScale = (attr0 & 0x0100) !== 0;
      const isHidden = !isRotScale && ((attr0 & 0x0200) !== 0);
      if (isHidden) continue;

      const shape = (attr0 >> 14) & 3;
      if (shape >= 3) continue;
      const sizeMode = (attr1 >> 14) & 3;

      const [sprWidth, sprHeight] = SIZES[shape][sizeMode];

      let y = attr0 & 0xFF;
      if (y >= 160) y -= 256;

      // Early scanline culling
      if (line < y || line >= y + sprHeight) continue;

      let x = attr1 & 0x1FF;
      if (x >= 240) x -= 512;

      // Early x culling - skip if entirely off screen
      if (x + sprWidth <= 0 || x >= 240) continue;

      const inSprY = (line - y);
      const is256Color = (attr0 & 0x2000) !== 0;
      const hFlip = !isRotScale && ((attr1 & 0x1000) !== 0);
      const vFlip = !isRotScale && ((attr1 & 0x2000) !== 0);
      const priority = (attr2 >> 10) & 3;
      const palGroup = (attr2 >> 12) & 0xF;
      const baseTile = attr2 & 0x3FF;

      const py = vFlip ? (sprHeight - 1 - inSprY) : inSprY;
      const tileRow = py >> 3;
      const inTileY = py & 7;
      const prioTag = (priority + 1) << 24;

      // Clamp loop to visible range
      const startX = Math.max(0, -x);
      const endX = Math.min(sprWidth, 240 - x);

      for (let sprX = startX; sprX < endX; sprX++) {
        const screenX = x + sprX;

        const px = hFlip ? (sprWidth - 1 - sprX) : sprX;
        const tileCol = px >> 3;
        const inTileX = px & 7;

        let curTile;
        if (is1DMapping) {
          curTile = baseTile + (tileRow * (sprWidth >> 3) + tileCol) * (is256Color ? 2 : 1);
        } else {
          curTile = baseTile + (tileRow * 32 + tileCol);
        }

        if (is256Color) {
          const offset = sprVramBase + (curTile * 32) + (inTileY * 8) + inTileX;
          const palIdx = sprVram[offset];
          if (palIdx !== 0) {
            lb[screenX] = prioTag | (colorLUT[palette16[objPal16Offset + palIdx] & 0x7FFF] & 0x00FFFFFF);
          }
        } else {
          const offset = sprVramBase + (curTile * 32) + (inTileY * 4) + (inTileX >> 1);
          const byteVal = sprVram[offset];
          const palIdx = (inTileX & 1) ? (byteVal >> 4) : (byteVal & 0x0F);
          if (palIdx !== 0) {
            lb[screenX] = prioTag | (colorLUT[palette16[objPal16Offset + palGroup * 16 + palIdx] & 0x7FFF] & 0x00FFFFFF);
          }
        }
      }
    }
  }
}
