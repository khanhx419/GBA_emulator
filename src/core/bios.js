// GBA High-Level Emulation (HLE) SWI BIOS functions

export class GBABios {
  constructor(gba) {
    this.gba = gba;
  }

  handleSwi(swiNumber) {
    const cpu = this.gba.cpu;
    const mmu = this.gba.mmu;

    switch (swiNumber) {
      case 0x00: // SoftReset
        this.gba.reset();
        break;

      case 0x01: // RegisterRamReset
        {
          const flags = cpu.gpr[0];
          mmu.registerRamReset(flags);
        }
        break;

      case 0x02: // Halt
        cpu.halted = true;
        break;

      case 0x03: // Stop
        cpu.stopped = true;
        break;

      case 0x04: // IntrWait
        {
          const clearOld = cpu.gpr[0];
          const flags = cpu.gpr[1];
          if (clearOld) {
            mmu.write16(0x04000202, mmu.read16(0x04000202) & ~flags); // IF
          }
          cpu.waitingIrq = flags;
          cpu.halted = true;
        }
        break;

      case 0x05: // VBlankIntrWait
        cpu.waitingIrq = 0x0001; // IRQ_VBLANK
        cpu.halted = true;
        break;

      case 0x06: // Div
        {
          const num = cpu.gpr[0] | 0;
          const denom = cpu.gpr[1] | 0;
          if (denom === 0) {
            cpu.gpr[0] = num >= 0 ? 0x7FFFFFFF : -0x80000000;
            cpu.gpr[1] = num;
            cpu.gpr[3] = 1;
          } else {
            cpu.gpr[0] = (num / denom) | 0;
            cpu.gpr[1] = (num % denom) | 0;
            cpu.gpr[3] = Math.abs(cpu.gpr[0]);
          }
        }
        break;

      case 0x07: // DivArm
        {
          const denom = cpu.gpr[0] | 0;
          const num = cpu.gpr[1] | 0;
          if (denom === 0) {
            cpu.gpr[0] = num >= 0 ? 0x7FFFFFFF : -0x80000000;
            cpu.gpr[1] = num;
            cpu.gpr[3] = 1;
          } else {
            cpu.gpr[0] = (num / denom) | 0;
            cpu.gpr[1] = (num % denom) | 0;
            cpu.gpr[3] = Math.abs(cpu.gpr[0]);
          }
        }
        break;

      case 0x08: // Sqrt
        {
          const val = cpu.gpr[0] >>> 0;
          cpu.gpr[0] = Math.floor(Math.sqrt(val)) >>> 0;
        }
        break;

      case 0x09: // ArcTan
        {
          const val = (cpu.gpr[0] << 16) >> 16;
          const rad = Math.atan(val / 16384.0);
          cpu.gpr[0] = Math.round((rad / (2 * Math.PI)) * 0x10000) & 0xFFFF;
        }
        break;

      case 0x0A: // ArcTan2
        {
          const x = (cpu.gpr[0] << 16) >> 16;
          const y = (cpu.gpr[1] << 16) >> 16;
          const rad = Math.atan2(y, x);
          cpu.gpr[0] = Math.round((rad / (2 * Math.PI)) * 0x10000) & 0xFFFF;
        }
        break;

      case 0x0B: // CpuSet
        {
          const src = cpu.gpr[0] >>> 0;
          let dst = cpu.gpr[1] >>> 0;
          const control = cpu.gpr[2] >>> 0;
          const count = control & 0x1FFFFF;
          const is32 = (control & 0x04000000) !== 0;
          const fixedSrc = (control & 0x01000000) !== 0;

          if (is32) {
            let s = src;
            const val = mmu.read32(s);
            for (let i = 0; i < count; i++) {
              mmu.write32(dst, fixedSrc ? val : mmu.read32(s));
              dst = (dst + 4) >>> 0;
              if (!fixedSrc) s = (s + 4) >>> 0;
            }
          } else {
            let s = src;
            const val = mmu.read16(s);
            for (let i = 0; i < count; i++) {
              mmu.write16(dst, fixedSrc ? val : mmu.read16(s));
              dst = (dst + 2) >>> 0;
              if (!fixedSrc) s = (s + 2) >>> 0;
            }
          }
        }
        break;

      case 0x0C: // CpuFastSet
        {
          const src = cpu.gpr[0] >>> 0;
          let dst = cpu.gpr[1] >>> 0;
          const control = cpu.gpr[2] >>> 0;
          let count = (control & 0x1FFFFF);
          count = ((count + 7) & ~7); // round up to multiple of 8
          const fixedSrc = (control & 0x01000000) !== 0;

          let s = src;
          const val = mmu.read32(s);
          for (let i = 0; i < count; i++) {
            mmu.write32(dst, fixedSrc ? val : mmu.read32(s));
            dst = (dst + 4) >>> 0;
            if (!fixedSrc) s = (s + 4) >>> 0;
          }
        }
        break;

      case 0x0E: // BgAffineSet
        {
          const src = cpu.gpr[0] >>> 0;
          let dst = cpu.gpr[1] >>> 0;
          const count = cpu.gpr[2] >>> 0;
          for (let i = 0; i < count; i++) {
            const cx = mmu.read32(src + i * 24 + 0);
            const cy = mmu.read32(src + i * 24 + 4);
            const dx = mmu.read16(src + i * 24 + 8) << 16 >> 16;
            const dy = mmu.read16(src + i * 24 + 10) << 16 >> 16;
            const sx = (mmu.read16(src + i * 24 + 12) << 16 >> 16) / 256.0;
            const sy = (mmu.read16(src + i * 24 + 14) << 16 >> 16) / 256.0;
            const theta = (mmu.read16(src + i * 24 + 16) & 0xFFFF) / 65536.0 * (2 * Math.PI);

            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);

            const pa = Math.round(sx * cosT * 256);
            const pb = Math.round(-sx * sinT * 256);
            const pc = Math.round(sy * sinT * 256);
            const pd = Math.round(sy * cosT * 256);

            const startX = cx - (pa * dx + pb * dy);
            const startY = cy - (pc * dx + pd * dy);

            mmu.write16(dst + 0, pa);
            mmu.write16(dst + 2, pb);
            mmu.write16(dst + 4, pc);
            mmu.write16(dst + 6, pd);
            mmu.write32(dst + 8, startX);
            mmu.write32(dst + 12, startY);
            dst += 16;
          }
        }
        break;

      case 0x0F: // ObjAffineSet
        {
          const src = cpu.gpr[0] >>> 0;
          let dst = cpu.gpr[1] >>> 0;
          const count = cpu.gpr[2] >>> 0;
          const offset = cpu.gpr[3] >>> 0;

          for (let i = 0; i < count; i++) {
            const sx = (mmu.read16(src + i * 8 + 0) << 16 >> 16) / 256.0;
            const sy = (mmu.read16(src + i * 8 + 2) << 16 >> 16) / 256.0;
            const theta = (mmu.read16(src + i * 8 + 4) & 0xFFFF) / 65536.0 * (2 * Math.PI);

            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);

            const pa = Math.round(sx * cosT * 256);
            const pb = Math.round(-sx * sinT * 256);
            const pc = Math.round(sy * sinT * 256);
            const pd = Math.round(sy * cosT * 256);

            mmu.write16(dst + 0 * offset, pa);
            mmu.write16(dst + 1 * offset, pb);
            mmu.write16(dst + 2 * offset, pc);
            mmu.write16(dst + 3 * offset, pd);
            dst += 4 * offset;
          }
        }
        break;

      case 0x11: // LZ77UnCompWram / LZ77UnCompVram
      case 0x12:
        {
          let src = cpu.gpr[0] >>> 0;
          let dst = cpu.gpr[1] >>> 0;
          const header = mmu.read32(src);
          src += 4;
          let decompressedSize = header >>> 8;

          while (decompressedSize > 0) {
            const flags = mmu.read8(src++);
            for (let bit = 7; bit >= 0 && decompressedSize > 0; bit--) {
              if ((flags & (1 << bit)) === 0) {
                // Direct byte
                const b = mmu.read8(src++);
                mmu.write8(dst++, b);
                decompressedSize--;
              } else {
                // Compressed block
                const b1 = mmu.read8(src++);
                const b2 = mmu.read8(src++);
                const length = (b1 >> 4) + 3;
                const disp = (((b1 & 0xF) << 8) | b2) + 1;
                let copySrc = dst - disp;
                for (let k = 0; k < length && decompressedSize > 0; k++) {
                  const b = mmu.read8(copySrc++);
                  mmu.write8(dst++, b);
                  decompressedSize--;
                }
              }
            }
          }
        }
        break;

      case 0x13: // HuffUnComp
        // Basic HuffUnComp fallthrough
        break;

      case 0x14: // RLUnCompWram
      case 0x15: // RLUnCompVram
        {
          let src = cpu.gpr[0] >>> 0;
          let dst = cpu.gpr[1] >>> 0;
          const header = mmu.read32(src);
          src += 4;
          let decompressedSize = header >>> 8;

          while (decompressedSize > 0) {
            const flag = mmu.read8(src++);
            const count = (flag & 0x7F) + (flag & 0x80 ? 3 : 1);
            if (flag & 0x80) {
              const val = mmu.read8(src++);
              for (let i = 0; i < count && decompressedSize > 0; i++) {
                mmu.write8(dst++, val);
                decompressedSize--;
              }
            } else {
              for (let i = 0; i < count && decompressedSize > 0; i++) {
                mmu.write8(dst++, mmu.read8(src++));
                decompressedSize--;
              }
            }
          }
        }
        break;

      default:
        break;
    }
  }
}
