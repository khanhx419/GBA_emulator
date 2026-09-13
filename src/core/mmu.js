import { MEMORY, IO } from './gba-constants.js';

export class GBAMMU {
  constructor(gba) {
    this.gba = gba;

    this.bios = new Uint8Array(MEMORY.BIOS_SIZE);
    this.ewram = new Uint8Array(MEMORY.EWRAM_SIZE);
    this.iwram = new Uint8Array(MEMORY.IWRAM_SIZE);
    this.io = new Uint8Array(MEMORY.IO_SIZE);
    this.palette = new Uint8Array(MEMORY.PALETTE_SIZE);
    this.vram = new Uint8Array(MEMORY.VRAM_SIZE);
    this.oam = new Uint8Array(MEMORY.OAM_SIZE);
    this.rom = new Uint8Array(0);
    this.romSize = 0;
    this.romMask = 0;

    // Save Memory
    this.saveType = 'SRAM'; // SRAM, FLASH64, FLASH128, EEPROM
    this.saveData = new Uint8Array(MEMORY.FLASH_128_SIZE);
    this.saveDirty = false;

    // Flash state
    this.flashState = 0;
    this.flashBank = 0;
    this.flashIdMode = false;

    // Fast DataView wrappers
    this.ewramView = new DataView(this.ewram.buffer);
    this.iwramView = new DataView(this.iwram.buffer);
    this.ioView = new DataView(this.io.buffer);
    this.paletteView = new DataView(this.palette.buffer);
    this.vramView = new DataView(this.vram.buffer);
    this.oamView = new DataView(this.oam.buffer);
    this.saveView = new DataView(this.saveData.buffer);

    this.keyState = 0x03FF; // all buttons released (active low)
  }

  loadRom(arrayBuffer) {
    this.rom = new Uint8Array(arrayBuffer);
    this.romSize = this.rom.length;
    // Power of 2 mask
    let mask = 1;
    while (mask < this.romSize) mask <<= 1;
    this.romMask = mask - 1;
    this.romView = new DataView(this.rom.buffer);

    this.detectSaveType();
    this.reset();
  }

  detectSaveType() {
    // Fast byte sequence search in ROM binary without decoding 32MB string
    const rom = this.rom;
    const findAscii = (str) => {
      const len = str.length;
      const b0 = str.charCodeAt(0);
      const b1 = str.charCodeAt(1);
      const limit = rom.length - len;
      for (let i = 0; i <= limit; i += 4) {
        if (rom[i] === b0 && rom[i + 1] === b1) {
          let matched = true;
          for (let j = 2; j < len; j++) {
            if (rom[i + j] !== str.charCodeAt(j)) {
              matched = false;
              break;
            }
          }
          if (matched) return true;
        }
      }
      return false;
    };

    if (findAscii('FLASH1M_V') || findAscii('FLASH_V128') || findAscii('FLASH1M')) {
      this.saveType = 'FLASH128';
      this.saveData = new Uint8Array(MEMORY.FLASH_128_SIZE);
    } else if (findAscii('FLASH512_V') || findAscii('FLASH_V') || findAscii('FLASH')) {
      this.saveType = 'FLASH64';
      this.saveData = new Uint8Array(MEMORY.FLASH_64_SIZE);
    } else if (findAscii('EEPROM_V') || findAscii('EEPROM')) {
      this.saveType = 'EEPROM';
      this.saveData = new Uint8Array(MEMORY.EEPROM_8K_SIZE);
    } else {
      this.saveType = 'SRAM';
      this.saveData = new Uint8Array(MEMORY.SRAM_SIZE);
    }
    this.saveData.fill(0xFF);
    this.saveView = new DataView(this.saveData.buffer);
  }

  reset() {
    this.ewram.fill(0);
    this.iwram.fill(0);
    this.io.fill(0);
    this.palette.fill(0);
    this.vram.fill(0);
    this.oam.fill(0);
    this.keyState = 0x03FF;
    this.flashState = 0;
    this.flashBank = 0;
    this.flashIdMode = false;
    this.write16(0x04000130, this.keyState); // KEYINPUT
  }

  registerRamReset(flags) {
    if (flags & 0x01) this.ewram.fill(0);
    if (flags & 0x02) this.iwram.fill(0);
    if (flags & 0x04) this.palette.fill(0);
    if (flags & 0x08) this.vram.fill(0);
    if (flags & 0x10) this.oam.fill(0);
  }

  read8(addr) {
    addr = addr >>> 0;
    const region = addr >>> 24;

    switch (region) {
      case 0x00: // BIOS
        if (addr < MEMORY.BIOS_SIZE) return this.bios[addr];
        return 0;
      case 0x02: // EWRAM
        return this.ewram[addr & (MEMORY.EWRAM_SIZE - 1)];
      case 0x03: // IWRAM
        return this.iwram[addr & (MEMORY.IWRAM_SIZE - 1)];
      case 0x04: // IO Registers
        return this.readIO8(addr & 0x3FF);
      case 0x05: // Palette RAM
        return this.palette[addr & (MEMORY.PALETTE_SIZE - 1)];
      case 0x06: // VRAM
        {
          let offset = addr & 0x1FFFF;
          if (offset >= MEMORY.VRAM_SIZE) offset -= 0x8000;
          return this.vram[offset];
        }
      case 0x07: // OAM
        return this.oam[addr & (MEMORY.OAM_SIZE - 1)];
      case 0x08:
      case 0x09:
      case 0x0A:
      case 0x0B:
      case 0x0C:
      case 0x0D: // ROM Game Pak
        {
          const offset = (addr & 0x01FFFFFF);
          if (offset < this.romSize) return this.rom[offset];
          return 0;
        }
      case 0x0E:
      case 0x0F: // SRAM / Flash
        return this.readSave8(addr & 0xFFFF);
      default:
        return 0;
    }
  }

  read16(addr) {
    addr = (addr & ~1) >>> 0;
    const region = addr >>> 24;

    switch (region) {
      case 0x00:
        if (addr < MEMORY.BIOS_SIZE) return this.bios[addr] | (this.bios[addr + 1] << 8);
        return 0;
      case 0x02:
        return this.ewramView.getUint16(addr & (MEMORY.EWRAM_SIZE - 1), true);
      case 0x03:
        return this.iwramView.getUint16(addr & (MEMORY.IWRAM_SIZE - 1), true);
      case 0x04:
        return this.readIO16(addr & 0x3FE);
      case 0x05:
        return this.paletteView.getUint16(addr & (MEMORY.PALETTE_SIZE - 1), true);
      case 0x06:
        {
          let offset = addr & 0x1FFFE;
          if (offset >= MEMORY.VRAM_SIZE) offset -= 0x8000;
          return this.vramView.getUint16(offset, true);
        }
      case 0x07:
        return this.oamView.getUint16(addr & (MEMORY.OAM_SIZE - 1), true);
      case 0x08:
      case 0x09:
      case 0x0A:
      case 0x0B:
      case 0x0C:
      case 0x0D:
        {
          const offset = (addr & 0x01FFFFFE);
          if (offset + 1 < this.romSize) return this.romView.getUint16(offset, true);
          if (offset < this.romSize) return this.rom[offset];
          return 0;
        }
      case 0x0E:
      case 0x0F:
        return this.readSave8(addr & 0xFFFF) * 0x0101;
      default:
        return 0;
    }
  }

  read32(addr) {
    addr = (addr & ~3) >>> 0;
    const region = addr >>> 24;

    switch (region) {
      case 0x00:
        if (addr + 3 < MEMORY.BIOS_SIZE) {
          return (this.bios[addr]) | (this.bios[addr + 1] << 8) | (this.bios[addr + 2] << 16) | (this.bios[addr + 3] << 24);
        }
        return 0;
      case 0x02:
        return this.ewramView.getUint32(addr & (MEMORY.EWRAM_SIZE - 1), true);
      case 0x03:
        return this.iwramView.getUint32(addr & (MEMORY.IWRAM_SIZE - 1), true);
      case 0x04:
        return (this.readIO16(addr & 0x3FC) | (this.readIO16((addr + 2) & 0x3FE) << 16)) >>> 0;
      case 0x05:
        return this.paletteView.getUint32(addr & (MEMORY.PALETTE_SIZE - 1), true);
      case 0x06:
        {
          let offset = addr & 0x1FFFC;
          if (offset >= MEMORY.VRAM_SIZE) offset -= 0x8000;
          return this.vramView.getUint32(offset, true);
        }
      case 0x07:
        return this.oamView.getUint32(addr & (MEMORY.OAM_SIZE - 1), true);
      case 0x08:
      case 0x09:
      case 0x0A:
      case 0x0B:
      case 0x0C:
      case 0x0D:
        {
          const offset = (addr & 0x01FFFFFC);
          if (offset + 3 < this.romSize) return this.romView.getUint32(offset, true);
          return (this.read16(offset) | (this.read16(offset + 2) << 16)) >>> 0;
        }
      case 0x0E:
      case 0x0F:
        return this.readSave8(addr & 0xFFFF) * 0x01010101;
      default:
        return 0;
    }
  }

  write8(addr, val) {
    addr = addr >>> 0;
    val = val & 0xFF;
    const region = addr >>> 24;

    switch (region) {
      case 0x02:
        this.ewram[addr & (MEMORY.EWRAM_SIZE - 1)] = val;
        break;
      case 0x03:
        this.iwram[addr & (MEMORY.IWRAM_SIZE - 1)] = val;
        break;
      case 0x04:
        this.writeIO8(addr & 0x3FF, val);
        break;
      case 0x05:
        // 8-bit write to Palette RAM writes byte to both bytes of halfword
        {
          const halfAddr = addr & (MEMORY.PALETTE_SIZE - 2);
          this.palette[halfAddr] = val;
          this.palette[halfAddr + 1] = val;
        }
        break;
      case 0x06:
        // 8-bit write to VRAM
        {
          let offset = addr & 0x1FFFF;
          if (offset >= MEMORY.VRAM_SIZE) offset -= 0x8000;
          const halfOffset = offset & ~1;
          this.vram[halfOffset] = val;
          this.vram[halfOffset + 1] = val;
        }
        break;
      case 0x07:
        // 8-bit writes to OAM are ignored
        break;
      case 0x0E:
      case 0x0F:
        this.writeSave8(addr & 0xFFFF, val);
        break;
      default:
        break;
    }
  }

  write16(addr, val) {
    addr = (addr & ~1) >>> 0;
    val = val & 0xFFFF;
    const region = addr >>> 24;

    switch (region) {
      case 0x02:
        this.ewramView.setUint16(addr & (MEMORY.EWRAM_SIZE - 1), val, true);
        break;
      case 0x03:
        this.iwramView.setUint16(addr & (MEMORY.IWRAM_SIZE - 1), val, true);
        break;
      case 0x04:
        this.writeIO16(addr & 0x3FE, val);
        break;
      case 0x05:
        this.paletteView.setUint16(addr & (MEMORY.PALETTE_SIZE - 1), val, true);
        break;
      case 0x06:
        {
          let offset = addr & 0x1FFFE;
          if (offset >= MEMORY.VRAM_SIZE) offset -= 0x8000;
          this.vramView.setUint16(offset, val, true);
        }
        break;
      case 0x07:
        this.oamView.setUint16(addr & (MEMORY.OAM_SIZE - 1), val, true);
        break;
      case 0x0E:
      case 0x0F:
        this.writeSave8(addr & 0xFFFF, val & 0xFF);
        break;
      default:
        break;
    }
  }

  write32(addr, val) {
    addr = (addr & ~3) >>> 0;
    val = val >>> 0;
    const region = addr >>> 24;

    switch (region) {
      case 0x02:
        this.ewramView.setUint32(addr & (MEMORY.EWRAM_SIZE - 1), val, true);
        break;
      case 0x03:
        this.iwramView.setUint32(addr & (MEMORY.IWRAM_SIZE - 1), val, true);
        break;
      case 0x04:
        this.writeIO16(addr & 0x3FC, val & 0xFFFF);
        this.writeIO16((addr + 2) & 0x3FE, (val >>> 16) & 0xFFFF);
        break;
      case 0x05:
        this.paletteView.setUint32(addr & (MEMORY.PALETTE_SIZE - 1), val, true);
        break;
      case 0x06:
        {
          let offset = addr & 0x1FFFC;
          if (offset >= MEMORY.VRAM_SIZE) offset -= 0x8000;
          this.vramView.setUint32(offset, val, true);
        }
        break;
      case 0x07:
        this.oamView.setUint32(addr & (MEMORY.OAM_SIZE - 1), val, true);
        break;
      case 0x0E:
      case 0x0F:
        this.writeSave8(addr & 0xFFFF, val & 0xFF);
        break;
      default:
        break;
    }
  }

  readIO8(offset) {
    const half = this.readIO16(offset & ~1);
    return (offset & 1) ? (half >> 8) : (half & 0xFF);
  }

  writeIO8(offset, val) {
    const halfAddr = offset & ~1;
    let half = this.readIO16(halfAddr);
    if (offset & 1) {
      half = (half & 0x00FF) | (val << 8);
    } else {
      half = (half & 0xFF00) | val;
    }
    this.writeIO16(halfAddr, half);
  }

  readIO16(offset) {
    switch (offset) {
      case IO.DISPCNT: return this.gba.ppu.readDISPCNT();
      case IO.DISPSTAT: return this.gba.ppu.readDISPSTAT();
      case IO.VCOUNT: return this.gba.ppu.vcount;

      case IO.BG0CNT: return this.gba.ppu.bg[0].cnt;
      case IO.BG1CNT: return this.gba.ppu.bg[1].cnt;
      case IO.BG2CNT: return this.gba.ppu.bg[2].cnt;
      case IO.BG3CNT: return this.gba.ppu.bg[3].cnt;

      case IO.WININ: return this.gba.ppu.winIn;
      case IO.WINOUT: return this.gba.ppu.winOut;
      case IO.BLDCNT: return this.gba.ppu.bldCnt;
      case IO.BLDALPHA: return this.gba.ppu.bldAlpha;

      // Sound
      case IO.SOUND1CNT_L: return this.gba.apu.read16(0x60);
      case IO.SOUND1CNT_H: return this.gba.apu.read16(0x62);
      case IO.SOUND1CNT_X: return this.gba.apu.read16(0x64);
      case IO.SOUND2CNT_L: return this.gba.apu.read16(0x68);
      case IO.SOUND2CNT_H: return this.gba.apu.read16(0x6C);
      case IO.SOUND3CNT_L: return this.gba.apu.read16(0x70);
      case IO.SOUND3CNT_H: return this.gba.apu.read16(0x72);
      case IO.SOUND3CNT_X: return this.gba.apu.read16(0x74);
      case IO.SOUND4CNT_L: return this.gba.apu.read16(0x78);
      case IO.SOUND4CNT_H: return this.gba.apu.read16(0x7C);
      case IO.SOUNDCNT_L: return this.gba.apu.read16(0x80);
      case IO.SOUNDCNT_H: return this.gba.apu.read16(0x82);
      case IO.SOUNDCNT_X: return this.gba.apu.read16(0x84);
      case IO.SOUNDBIAS: return this.gba.apu.read16(0x88);

      // DMA
      case IO.DMA0CNT_L: return 0;
      case IO.DMA0CNT_H: return this.gba.dma.readControl(0);
      case IO.DMA1CNT_L: return 0;
      case IO.DMA1CNT_H: return this.gba.dma.readControl(1);
      case IO.DMA2CNT_L: return 0;
      case IO.DMA2CNT_H: return this.gba.dma.readControl(2);
      case IO.DMA3CNT_L: return 0;
      case IO.DMA3CNT_H: return this.gba.dma.readControl(3);

      // Timers
      case IO.TM0CNT_L: return this.gba.timers.readCounter(0);
      case IO.TM0CNT_H: return this.gba.timers.readControl(0);
      case IO.TM1CNT_L: return this.gba.timers.readCounter(1);
      case IO.TM1CNT_H: return this.gba.timers.readControl(1);
      case IO.TM2CNT_L: return this.gba.timers.readCounter(2);
      case IO.TM2CNT_H: return this.gba.timers.readControl(2);
      case IO.TM3CNT_L: return this.gba.timers.readCounter(3);
      case IO.TM3CNT_H: return this.gba.timers.readControl(3);

      // Keypad
      case IO.KEYINPUT: return this.keyState;
      case IO.KEYCNT: return this.ioView.getUint16(IO.KEYCNT, true);

      // Interrupts
      case IO.IE: return this.gba.interrupts.readIE();
      case IO.IF: return this.gba.interrupts.readIF();
      case IO.IME: return this.gba.interrupts.readIME();
      case IO.WAITCNT: return this.ioView.getUint16(IO.WAITCNT, true);

      default:
        if (offset < MEMORY.IO_SIZE) {
          return this.ioView.getUint16(offset, true);
        }
        return 0;
    }
  }

  writeIO16(offset, val) {
    if (offset < MEMORY.IO_SIZE) {
      this.ioView.setUint16(offset, val, true);
    }

    switch (offset) {
      case IO.DISPCNT: this.gba.ppu.writeDISPCNT(val); break;
      case IO.DISPSTAT: this.gba.ppu.writeDISPSTAT(val); break;

      case IO.BG0CNT: this.gba.ppu.bg[0].cnt = val; break;
      case IO.BG1CNT: this.gba.ppu.bg[1].cnt = val; break;
      case IO.BG2CNT: this.gba.ppu.bg[2].cnt = val; break;
      case IO.BG3CNT: this.gba.ppu.bg[3].cnt = val; break;

      case IO.BG0HOFS: this.gba.ppu.bg[0].x = val & 0x1FF; break;
      case IO.BG0VOFS: this.gba.ppu.bg[0].y = val & 0x1FF; break;
      case IO.BG1HOFS: this.gba.ppu.bg[1].x = val & 0x1FF; break;
      case IO.BG1VOFS: this.gba.ppu.bg[1].y = val & 0x1FF; break;
      case IO.BG2HOFS: this.gba.ppu.bg[2].x = val & 0x1FF; break;
      case IO.BG2VOFS: this.gba.ppu.bg[2].y = val & 0x1FF; break;
      case IO.BG3HOFS: this.gba.ppu.bg[3].x = val & 0x1FF; break;
      case IO.BG3VOFS: this.gba.ppu.bg[3].y = val & 0x1FF; break;

      case IO.BG2PA: this.gba.ppu.bg[2].pa = (val << 16) >> 16; break;
      case IO.BG2PB: this.gba.ppu.bg[2].pb = (val << 16) >> 16; break;
      case IO.BG2PC: this.gba.ppu.bg[2].pc = (val << 16) >> 16; break;
      case IO.BG2PD: this.gba.ppu.bg[2].pd = (val << 16) >> 16; break;
      case IO.BG2X_L: this.gba.ppu.bg[2].refX = (this.gba.ppu.bg[2].refX & ~0xFFFF) | val; break;
      case IO.BG2X_H: this.gba.ppu.bg[2].refX = (this.gba.ppu.bg[2].refX & 0xFFFF) | ((val & 0x0FFF) << 16); break;
      case IO.BG2Y_L: this.gba.ppu.bg[2].refY = (this.gba.ppu.bg[2].refY & ~0xFFFF) | val; break;
      case IO.BG2Y_H: this.gba.ppu.bg[2].refY = (this.gba.ppu.bg[2].refY & 0xFFFF) | ((val & 0x0FFF) << 16); break;

      case IO.BG3PA: this.gba.ppu.bg[3].pa = (val << 16) >> 16; break;
      case IO.BG3PB: this.gba.ppu.bg[3].pb = (val << 16) >> 16; break;
      case IO.BG3PC: this.gba.ppu.bg[3].pc = (val << 16) >> 16; break;
      case IO.BG3PD: this.gba.ppu.bg[3].pd = (val << 16) >> 16; break;
      case IO.BG3X_L: this.gba.ppu.bg[3].refX = (this.gba.ppu.bg[3].refX & ~0xFFFF) | val; break;
      case IO.BG3X_H: this.gba.ppu.bg[3].refX = (this.gba.ppu.bg[3].refX & 0xFFFF) | ((val & 0x0FFF) << 16); break;
      case IO.BG3Y_L: this.gba.ppu.bg[3].refY = (this.gba.ppu.bg[3].refY & ~0xFFFF) | val; break;
      case IO.BG3Y_H: this.gba.ppu.bg[3].refY = (this.gba.ppu.bg[3].refY & 0xFFFF) | ((val & 0x0FFF) << 16); break;

      case IO.WIN0H: this.gba.ppu.win0h = val; break;
      case IO.WIN1H: this.gba.ppu.win1h = val; break;
      case IO.WIN0V: this.gba.ppu.win0v = val; break;
      case IO.WIN1V: this.gba.ppu.win1v = val; break;
      case IO.WININ: this.gba.ppu.winIn = val; break;
      case IO.WINOUT: this.gba.ppu.winOut = val; break;
      case IO.MOSAIC: this.gba.ppu.mosaic = val; break;
      case IO.BLDCNT: this.gba.ppu.bldCnt = val; break;
      case IO.BLDALPHA: this.gba.ppu.bldAlpha = val; break;
      case IO.BLDY: this.gba.ppu.bldY = val & 0x1F; break;

      // Sound
      case IO.SOUND1CNT_L: this.gba.apu.write16(0x60, val); break;
      case IO.SOUND1CNT_H: this.gba.apu.write16(0x62, val); break;
      case IO.SOUND1CNT_X: this.gba.apu.write16(0x64, val); break;
      case IO.SOUND2CNT_L: this.gba.apu.write16(0x68, val); break;
      case IO.SOUND2CNT_H: this.gba.apu.write16(0x6C, val); break;
      case IO.SOUND3CNT_L: this.gba.apu.write16(0x70, val); break;
      case IO.SOUND3CNT_H: this.gba.apu.write16(0x72, val); break;
      case IO.SOUND3CNT_X: this.gba.apu.write16(0x74, val); break;
      case IO.SOUND4CNT_L: this.gba.apu.write16(0x78, val); break;
      case IO.SOUND4CNT_H: this.gba.apu.write16(0x7C, val); break;
      case IO.SOUNDCNT_L: this.gba.apu.write16(0x80, val); break;
      case IO.SOUNDCNT_H: this.gba.apu.write16(0x82, val); break;
      case IO.SOUNDCNT_X: this.gba.apu.write16(0x84, val); break;
      case IO.SOUNDBIAS: this.gba.apu.write16(0x88, val); break;

      case IO.FIFO_A: this.gba.apu.writeFifoA(val); break;
      case IO.FIFO_B: this.gba.apu.writeFifoB(val); break;

      // DMA
      case IO.DMA0SAD: this.gba.dma.writeSAD(0, (this.gba.dma.channels[0].sad & 0xFFFF0000) | val); break;
      case IO.DMA0SAD + 2: this.gba.dma.writeSAD(0, (this.gba.dma.channels[0].sad & 0x0000FFFF) | (val << 16)); break;
      case IO.DMA0DAD: this.gba.dma.writeDAD(0, (this.gba.dma.channels[0].dad & 0xFFFF0000) | val); break;
      case IO.DMA0DAD + 2: this.gba.dma.writeDAD(0, (this.gba.dma.channels[0].dad & 0x0000FFFF) | (val << 16)); break;
      case IO.DMA0CNT_L: this.gba.dma.writeCount(0, val); break;
      case IO.DMA0CNT_H: this.gba.dma.writeControl(0, val); break;

      case IO.DMA1SAD: this.gba.dma.writeSAD(1, (this.gba.dma.channels[1].sad & 0xFFFF0000) | val); break;
      case IO.DMA1SAD + 2: this.gba.dma.writeSAD(1, (this.gba.dma.channels[1].sad & 0x0000FFFF) | (val << 16)); break;
      case IO.DMA1DAD: this.gba.dma.writeDAD(1, (this.gba.dma.channels[1].dad & 0xFFFF0000) | val); break;
      case IO.DMA1DAD + 2: this.gba.dma.writeDAD(1, (this.gba.dma.channels[1].dad & 0x0000FFFF) | (val << 16)); break;
      case IO.DMA1CNT_L: this.gba.dma.writeCount(1, val); break;
      case IO.DMA1CNT_H: this.gba.dma.writeControl(1, val); break;

      case IO.DMA2SAD: this.gba.dma.writeSAD(2, (this.gba.dma.channels[2].sad & 0xFFFF0000) | val); break;
      case IO.DMA2SAD + 2: this.gba.dma.writeSAD(2, (this.gba.dma.channels[2].sad & 0x0000FFFF) | (val << 16)); break;
      case IO.DMA2DAD: this.gba.dma.writeDAD(2, (this.gba.dma.channels[2].dad & 0xFFFF0000) | val); break;
      case IO.DMA2DAD + 2: this.gba.dma.writeDAD(2, (this.gba.dma.channels[2].dad & 0x0000FFFF) | (val << 16)); break;
      case IO.DMA2CNT_L: this.gba.dma.writeCount(2, val); break;
      case IO.DMA2CNT_H: this.gba.dma.writeControl(2, val); break;

      case IO.DMA3SAD: this.gba.dma.writeSAD(3, (this.gba.dma.channels[3].sad & 0xFFFF0000) | val); break;
      case IO.DMA3SAD + 2: this.gba.dma.writeSAD(3, (this.gba.dma.channels[3].sad & 0x0000FFFF) | (val << 16)); break;
      case IO.DMA3DAD: this.gba.dma.writeDAD(3, (this.gba.dma.channels[3].dad & 0xFFFF0000) | val); break;
      case IO.DMA3DAD + 2: this.gba.dma.writeDAD(3, (this.gba.dma.channels[3].dad & 0x0000FFFF) | (val << 16)); break;
      case IO.DMA3CNT_L: this.gba.dma.writeCount(3, val); break;
      case IO.DMA3CNT_H: this.gba.dma.writeControl(3, val); break;

      // Timers
      case IO.TM0CNT_L: this.gba.timers.writeReload(0, val); break;
      case IO.TM0CNT_H: this.gba.timers.writeControl(0, val); break;
      case IO.TM1CNT_L: this.gba.timers.writeReload(1, val); break;
      case IO.TM1CNT_H: this.gba.timers.writeControl(1, val); break;
      case IO.TM2CNT_L: this.gba.timers.writeReload(2, val); break;
      case IO.TM2CNT_H: this.gba.timers.writeControl(2, val); break;
      case IO.TM3CNT_L: this.gba.timers.writeReload(3, val); break;
      case IO.TM3CNT_H: this.gba.timers.writeControl(3, val); break;

      // Interrupts
      case IO.IE: this.gba.interrupts.writeIE(val); break;
      case IO.IF: this.gba.interrupts.writeIF(val); break;
      case IO.IME: this.gba.interrupts.writeIME(val); break;

      default:
        break;
    }
  }

  readSave8(offset) {
    if (this.saveType === 'FLASH64' || this.saveType === 'FLASH128') {
      if (this.flashIdMode) {
        if (offset === 0) return 0x62; // Sanyo / Panasonic ID
        if (offset === 1) return this.saveType === 'FLASH128' ? 0x13 : 0x09;
      }
      const bankOffset = (this.flashBank * 0x10000) + offset;
      return this.saveData[bankOffset & (this.saveData.length - 1)];
    }
    return this.saveData[offset & (this.saveData.length - 1)];
  }

  writeSave8(offset, val) {
    this.saveDirty = true;
    if (this.saveType === 'FLASH64' || this.saveType === 'FLASH128') {
      if (this.flashState === 0 && offset === 0x5555 && val === 0xAA) {
        this.flashState = 1;
      } else if (this.flashState === 1 && offset === 0x2AAA && val === 0x55) {
        this.flashState = 2;
      } else if (this.flashState === 2) {
        if (offset === 0x5555 && val === 0x90) {
          this.flashIdMode = true;
        } else if (offset === 0x5555 && val === 0xF0) {
          this.flashIdMode = false;
        } else if (offset === 0x5555 && val === 0xB0) {
          // Bank switch
          this.flashState = 3;
          return;
        }
        this.flashState = 0;
      } else if (this.flashState === 3 && offset === 0) {
        this.flashBank = val & 1;
        this.flashState = 0;
      } else {
        const bankOffset = (this.flashBank * 0x10000) + offset;
        this.saveData[bankOffset & (this.saveData.length - 1)] = val;
        this.flashState = 0;
      }
      return;
    }
    this.saveData[offset & (this.saveData.length - 1)] = val;
  }
}
