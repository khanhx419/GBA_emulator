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

  rgb15To32(c) {
    const r = (c & 0x1F) << 3;
    const g = ((c >> 5) & 0x1F) << 3;
    const b = ((c >> 10) & 0x1F) << 3;
    return (0xFF << 24) | (b << 16) | (g << 8) | r;
  }

  renderScanline(line) {
    if (this.dispcnt & 0x0080) {
      // Forced Blank - render white
      const lineStart = line * SCREEN.WIDTH;
      for (let x = 0; x < SCREEN.WIDTH; x++) {
        this.framebuffer[lineStart + x] = 0xFFFFFFFF;
      }
      return;
    }

    const mode = this.dispcnt & 0x07;
    const mmu = this.gba.mmu;
    const lineStart = line * SCREEN.WIDTH;

    // Clear line buffers (0 = transparent)
    for (let i = 0; i < 5; i++) {
      this.layerBuffer[i].fill(0);
    }

    // Backdrop color (Palette 0)
    const backdropColor = this.rgb15To32(mmu.read16(0x05000000));

    // Render Mode 0, 1, 2, 3, 4, 5
    if (mode === 0) {
      // Text mode: BG0 - BG3
      for (let i = 0; i < 4; i++) {
        if (this.dispcnt & (1 << (8 + i))) {
          this.renderTextBG(i, line);
        }
      }
    } else if (mode === 1) {
      // Mixed: BG0, BG1 Text, BG2 Affine
      if (this.dispcnt & 0x0100) this.renderTextBG(0, line);
      if (this.dispcnt & 0x0200) this.renderTextBG(1, line);
      if (this.dispcnt & 0x0400) this.renderAffineBG(2, line);
    } else if (mode === 2) {
      // Affine: BG2, BG3
      if (this.dispcnt & 0x0400) this.renderAffineBG(2, line);
      if (this.dispcnt & 0x0800) this.renderAffineBG(3, line);
    } else if (mode === 3) {
      // Bitmap 240x160 16-bit direct color
      if (this.dispcnt & 0x0400) {
        const vramOffset = line * 240 * 2;
        for (let x = 0; x < 240; x++) {
          const col = mmu.read16(0x06000000 + vramOffset + x * 2);
          this.layerBuffer[2][x] = this.rgb15To32(col);
        }
      }
    } else if (mode === 4) {
      // Bitmap 240x160 8-bit palette indexed (Page 0 or 1)
      if (this.dispcnt & 0x0400) {
        const page = (this.dispcnt & 0x0010) ? 0xA000 : 0x0000;
        const vramOffset = page + line * 240;
        for (let x = 0; x < 240; x++) {
          const palIdx = mmu.read8(0x06000000 + vramOffset + x);
          if (palIdx !== 0) {
            const col = mmu.read16(0x05000000 + palIdx * 2);
            this.layerBuffer[2][x] = this.rgb15To32(col);
          }
        }
      }
    }

    // Render Sprites (OBJ)
    if (this.dispcnt & 0x1000) {
      this.renderSprites(line);
    }

    // Compose layers with Priority and Backdrop
    for (let x = 0; x < SCREEN.WIDTH; x++) {
      let finalColor = backdropColor;
      let highestPrio = 4;

      // Check layers in priority order (0 to 3)
      for (let prio = 3; prio >= 0; prio--) {
        // Check BGs
        for (let bgIdx = 3; bgIdx >= 0; bgIdx--) {
          if ((this.dispcnt & (1 << (8 + bgIdx))) && (this.bg[bgIdx].cnt & 3) === prio) {
            const c = this.layerBuffer[bgIdx][x];
            if (c !== 0) {
              finalColor = c;
            }
          }
        }
        // Check OBJ
        const objCol = this.layerBuffer[4][x];
        if (objCol !== 0 && (objCol >>> 24) === (prio + 1)) {
          finalColor = (objCol & 0x00FFFFFF) | 0xFF000000;
        }
      }

      this.framebuffer[lineStart + x] = finalColor;
    }
  }

  renderTextBG(bgIdx, line) {
    const bg = this.bg[bgIdx];
    const mmu = this.gba.mmu;
    const cnt = bg.cnt;

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

    for (let x = 0; x < SCREEN.WIDTH; x++) {
      const curX = (scrollX + x) % width;
      const tileX = (curX >> 3);
      const inTileX = curX & 7;

      let mapBase = screenBase;
      if (width === 512 && curX >= 256) mapBase += 0x800;
      if (height === 512 && scrollY >= 256) mapBase += (width === 512 ? 0x1000 : 0x800);

      const mapOffset = mapBase + ((tileY & 31) * 32 + (tileX & 31)) * 2;
      const tileEntry = mmu.read16(0x06000000 + mapOffset);

      const tileNum = tileEntry & 0x3FF;
      const hFlip = (tileEntry & 0x0400) !== 0;
      const vFlip = (tileEntry & 0x0800) !== 0;
      const palGroup = (tileEntry >> 12) & 0xF;

      const px = hFlip ? (7 - inTileX) : inTileX;
      const py = vFlip ? (7 - inTileY) : inTileY;

      let palIdx = 0;
      if (is256Color) {
        const charOffset = charBase + tileNum * 64 + py * 8 + px;
        palIdx = mmu.read8(0x06000000 + charOffset);
        if (palIdx !== 0) {
          const col = mmu.read16(0x05000000 + palIdx * 2);
          this.layerBuffer[bgIdx][x] = this.rgb15To32(col);
        }
      } else {
        const charOffset = charBase + tileNum * 32 + py * 4 + (px >> 1);
        const byteVal = mmu.read8(0x06000000 + charOffset);
        palIdx = (px & 1) ? (byteVal >> 4) : (byteVal & 0x0F);
        if (palIdx !== 0) {
          const col = mmu.read16(0x05000000 + (palGroup * 16 + palIdx) * 2);
          this.layerBuffer[bgIdx][x] = this.rgb15To32(col);
        }
      }
    }
  }

  renderAffineBG(bgIdx, line) {
    const bg = this.bg[bgIdx];
    const mmu = this.gba.mmu;
    const cnt = bg.cnt;

    const charBase = ((cnt >> 2) & 3) * 0x4000;
    const screenBase = ((cnt >> 8) & 0x1F) * 0x800;
    const sizeShift = 7 + ((cnt >> 14) & 3); // 128, 256, 512, 1024
    const size = 1 << sizeShift;
    const wrap = (cnt & 0x2000) !== 0;

    let xVal = bg.curX;
    let yVal = bg.curY;

    for (let x = 0; x < SCREEN.WIDTH; x++) {
      let px = xVal >> 8;
      let py = yVal >> 8;

      xVal += bg.pa;
      yVal += bg.pc;

      if (wrap) {
        px = (px & (size - 1));
        py = (py & (size - 1));
      } else if (px < 0 || px >= size || py < 0 || py >= size) {
        continue;
      }

      const tileX = px >> 3;
      const tileY = py >> 3;
      const inTileX = px & 7;
      const inTileY = py & 7;

      const tilesPerRow = size >> 3;
      const mapOffset = screenBase + (tileY * tilesPerRow + tileX);
      const tileNum = mmu.read8(0x06000000 + mapOffset);

      const charOffset = charBase + tileNum * 64 + inTileY * 8 + inTileX;
      const palIdx = mmu.read8(0x06000000 + charOffset);
      if (palIdx !== 0) {
        const col = mmu.read16(0x05000000 + palIdx * 2);
        this.layerBuffer[bgIdx][x] = this.rgb15To32(col);
      }
    }
  }

  renderSprites(line) {
    const mmu = this.gba.mmu;
    const is1DMapping = (this.dispcnt & 0x0040) !== 0;

    // Scan all 128 OAM entries
    for (let i = 127; i >= 0; i--) {
      const oamOffset = 0x07000000 + i * 8;
      const attr0 = mmu.read16(oamOffset + 0);
      const attr1 = mmu.read16(oamOffset + 2);
      const attr2 = mmu.read16(oamOffset + 4);

      const isRotScale = (attr0 & 0x0100) !== 0;
      const isHidden = !isRotScale && ((attr0 & 0x0200) !== 0);
      if (isHidden) continue;

      const shape = (attr0 >> 14) & 3;
      const sizeMode = (attr1 >> 14) & 3;

      let sprWidth = 8, sprHeight = 8;
      const SIZES = [
        [[8,8],[16,16],[32,32],[64,64]],       // Square
        [[16,8],[32,8],[32,16],[64,32]],      // Horizontal
        [[8,16],[8,32],[16,32],[32,64]]       // Vertical
      ];
      if (shape < 3) {
        [sprWidth, sprHeight] = SIZES[shape][sizeMode];
      }

      let y = attr0 & 0xFF;
      if (y >= 160) y -= 256;

      let x = attr1 & 0x1FF;
      if (x >= 240) x -= 512;

      if (line < y || line >= y + sprHeight) continue;

      const inSprY = (line - y);
      const is256Color = (attr0 & 0x2000) !== 0;
      const hFlip = !isRotScale && ((attr1 & 0x1000) !== 0);
      const vFlip = !isRotScale && ((attr1 & 0x2000) !== 0);
      const priority = (attr2 >> 10) & 3;
      const palGroup = (attr2 >> 12) & 0xF;
      let baseTile = attr2 & 0x3FF;

      const py = vFlip ? (sprHeight - 1 - inSprY) : inSprY;
      const tileRow = py >> 3;
      const inTileY = py & 7;

      for (let sprX = 0; sprX < sprWidth; sprX++) {
        const screenX = x + sprX;
        if (screenX < 0 || screenX >= SCREEN.WIDTH) continue;

        const px = hFlip ? (sprWidth - 1 - sprX) : sprX;
        const tileCol = px >> 3;
        const inTileX = px & 7;

        let curTile = 0;
        if (is1DMapping) {
          curTile = baseTile + (tileRow * (sprWidth >> 3) + tileCol) * (is256Color ? 2 : 1);
        } else {
          curTile = baseTile + (tileRow * 32 + tileCol);
        }

        let palIdx = 0;
        if (is256Color) {
          const offset = 0x06010000 + (curTile * 32) + (inTileY * 8) + inTileX;
          palIdx = mmu.read8(offset);
          if (palIdx !== 0) {
            const col = mmu.read16(0x05000200 + palIdx * 2);
            // Store priority in alpha upper byte: (priority + 1)
            this.layerBuffer[4][screenX] = ((priority + 1) << 24) | (this.rgb15To32(col) & 0x00FFFFFF);
          }
        } else {
          const offset = 0x06010000 + (curTile * 32) + (inTileY * 4) + (inTileX >> 1);
          const byteVal = mmu.read8(offset);
          palIdx = (inTileX & 1) ? (byteVal >> 4) : (byteVal & 0x0F);
          if (palIdx !== 0) {
            const col = mmu.read16(0x05000200 + (palGroup * 16 + palIdx) * 2);
            this.layerBuffer[4][screenX] = ((priority + 1) << 24) | (this.rgb15To32(col) & 0x00FFFFFF);
          }
        }
      }
    }
  }
}
