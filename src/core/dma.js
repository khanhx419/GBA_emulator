import { IRQ, IO } from './gba-constants.js';

export class GBADMA {
  constructor(gba) {
    this.gba = gba;
    this.channels = [
      { sad: 0, dad: 0, count: 0, control: 0, curSad: 0, curDad: 0, curCount: 0, enabled: false, timing: 0, is32: false, repeat: false, srcInc: 0, dstInc: 0, irq: false, drq: false },
      { sad: 0, dad: 0, count: 0, control: 0, curSad: 0, curDad: 0, curCount: 0, enabled: false, timing: 0, is32: false, repeat: false, srcInc: 0, dstInc: 0, irq: false, drq: false },
      { sad: 0, dad: 0, count: 0, control: 0, curSad: 0, curDad: 0, curCount: 0, enabled: false, timing: 0, is32: false, repeat: false, srcInc: 0, dstInc: 0, irq: false, drq: false },
      { sad: 0, dad: 0, count: 0, control: 0, curSad: 0, curDad: 0, curCount: 0, enabled: false, timing: 0, is32: false, repeat: false, srcInc: 0, dstInc: 0, irq: false, drq: false }
    ];
  }

  reset() {
    for (let i = 0; i < 4; i++) {
      this.channels[i] = {
        sad: 0, dad: 0, count: 0, control: 0,
        curSad: 0, curDad: 0, curCount: 0,
        enabled: false, timing: 0, is32: false, repeat: false,
        srcInc: 0, dstInc: 0, irq: false, drq: false
      };
    }
  }

  trigger(timing) {
    for (let i = 0; i < 4; i++) {
      const ch = this.channels[i];
      if (ch.enabled && ch.timing === timing) {
        this.runChannel(i);
      }
    }
  }

  runChannel(index) {
    const ch = this.channels[index];
    const mmu = this.gba.mmu;
    const is32 = ch.is32;
    const step = is32 ? 4 : 2;

    let count = ch.curCount;
    if (count === 0) count = index === 3 ? 0x10000 : 0x4000;

    // Special sound FIFO transfer (4 words = 16 bytes)
    if (ch.timing === 3 && (index === 1 || index === 2)) {
      count = 4;
    }

    let src = ch.curSad;
    let dst = ch.curDad;

    for (let i = 0; i < count; i++) {
      if (is32) {
        const val = mmu.read32(src);
        mmu.write32(dst, val);
      } else {
        const val = mmu.read16(src);
        mmu.write16(dst, val);
      }

      // Increment / decrement src
      if (ch.srcInc === 0) src = (src + step) >>> 0;
      else if (ch.srcInc === 1) src = (src - step) >>> 0;

      // Increment / decrement dst
      if (ch.dstInc === 0 || ch.dstInc === 3) dst = (dst + step) >>> 0;
      else if (ch.dstInc === 1) dst = (dst - step) >>> 0;
    }

    ch.curSad = src;
    ch.curDad = ch.dstInc === 3 ? ch.dad : dst;

    if (ch.repeat && ch.timing !== 0) {
      ch.curCount = ch.count;
    } else {
      ch.enabled = false;
      ch.control &= ~0x8000;
    }

    if (ch.irq) {
      this.gba.interrupts.raise(IRQ.DMA0 << index);
    }
  }

  writeSAD(i, val) {
    this.channels[i].sad = val >>> 0;
    this.channels[i].curSad = val >>> 0;
  }

  writeDAD(i, val) {
    this.channels[i].dad = val >>> 0;
    this.channels[i].curDad = val >>> 0;
  }

  writeCount(i, val) {
    const max = i === 3 ? 0x10000 : 0x4000;
    const count = (val & (max - 1));
    this.channels[i].count = count === 0 ? max : count;
    this.channels[i].curCount = this.channels[i].count;
  }

  readControl(i) {
    return this.channels[i].control;
  }

  writeControl(i, val) {
    const ch = this.channels[i];
    const wasEnabled = ch.enabled;
    ch.control = val & 0xFFE0;

    ch.dstInc = (val >> 5) & 0x03;
    ch.srcInc = (val >> 7) & 0x03;
    ch.repeat = (val & 0x0200) !== 0;
    ch.is32 = (val & 0x0400) !== 0;
    ch.drq = (val & 0x0800) !== 0;
    ch.timing = (val >> 12) & 0x03;
    ch.irq = (val & 0x4000) !== 0;
    ch.enabled = (val & 0x8000) !== 0;

    if (!wasEnabled && ch.enabled) {
      ch.curSad = ch.sad;
      ch.curDad = ch.dad;
      ch.curCount = ch.count === 0 ? (i === 3 ? 0x10000 : 0x4000) : ch.count;

      if (ch.timing === 0) {
        // Immediate start
        this.runChannel(i);
      }
    }
  }
}
