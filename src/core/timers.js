import { IRQ, IO } from './gba-constants.js';

export class GBATimers {
  constructor(gba) {
    this.gba = gba;
    this.timers = [
      { reload: 0, count: 0, control: 0, enabled: false, irq: false, countUp: false, prescaler: 1, subCycle: 0 },
      { reload: 0, count: 0, control: 0, enabled: false, irq: false, countUp: false, prescaler: 1, subCycle: 0 },
      { reload: 0, count: 0, control: 0, enabled: false, irq: false, countUp: false, prescaler: 1, subCycle: 0 },
      { reload: 0, count: 0, control: 0, enabled: false, irq: false, countUp: false, prescaler: 1, subCycle: 0 }
    ];
  }

  reset() {
    for (let i = 0; i < 4; i++) {
      this.timers[i] = {
        reload: 0,
        count: 0,
        control: 0,
        enabled: false,
        irq: false,
        countUp: false,
        prescaler: 1,
        subCycle: 0
      };
    }
  }

  step(cycles) {
    for (let i = 0; i < 4; i++) {
      const tm = this.timers[i];
      if (!tm.enabled || tm.countUp) continue;

      tm.subCycle += cycles;
      const ticks = (tm.subCycle / tm.prescaler) | 0;
      if (ticks > 0) {
        tm.subCycle %= tm.prescaler;
        this.incrementTimer(i, ticks);
      }
    }
  }

  incrementTimer(index, ticks) {
    const tm = this.timers[index];
    const newCount = tm.count + ticks;

    if (newCount > 0xFFFF) {
      const overflows = Math.floor(newCount / 0x10000);
      tm.count = (tm.reload + (newCount - 0x10000 * overflows)) & 0xFFFF;

      // Trigger IRQ
      if (tm.irq) {
        this.gba.interrupts.raise(IRQ.TIMER0 << index);
      }

      // Trigger APU DirectSound DMA if timer matches
      this.gba.apu.onTimerOverflow(index);

      // Cascade to next timer if count-up enabled
      if (index < 3 && this.timers[index + 1].enabled && this.timers[index + 1].countUp) {
        this.incrementTimer(index + 1, overflows);
      }
    } else {
      tm.count = newCount;
    }
  }

  readReload(i) { return this.timers[i].reload; }
  writeReload(i, val) { this.timers[i].reload = val & 0xFFFF; }

  readCounter(i) { return this.timers[i].count; }

  readControl(i) { return this.timers[i].control; }
  writeControl(i, val) {
    const tm = this.timers[i];
    const wasEnabled = tm.enabled;
    tm.control = val & 0x00FF;

    const prescalerBits = val & 0x03;
    if (prescalerBits === 0) tm.prescaler = 1;
    else if (prescalerBits === 1) tm.prescaler = 64;
    else if (prescalerBits === 2) tm.prescaler = 256;
    else tm.prescaler = 1024;

    tm.countUp = (val & 0x04) !== 0 && i > 0;
    tm.irq = (val & 0x40) !== 0;
    tm.enabled = (val & 0x80) !== 0;

    if (!wasEnabled && tm.enabled) {
      tm.count = tm.reload;
      tm.subCycle = 0;
    }
  }
}
