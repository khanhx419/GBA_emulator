import { IRQ, IO } from './gba-constants.js';

export class GBAInterrupts {
  constructor(gba) {
    this.gba = gba;
    this.ime = 0; // Interrupt Master Enable
    this.ie = 0;  // Interrupt Enable
    this.if = 0;  // Interrupt Flag (pending)
  }

  reset() {
    this.ime = 0;
    this.ie = 0;
    this.if = 0;
  }

  raise(irqMask) {
    this.if |= irqMask;
    if (this.ime && (this.ie & this.if)) {
      this.gba.cpu.triggerIrq();
    }
    if (this.gba.cpu.halted && (this.gba.cpu.waitingIrq & this.if)) {
      this.gba.cpu.halted = false;
      this.gba.cpu.waitingIrq = 0;
    }
  }

  checkIrq() {
    if (this.ime && (this.ie & this.if)) {
      this.gba.cpu.triggerIrq();
    }
  }

  readIE() { return this.ie; }
  writeIE(val) {
    this.ie = val & 0x3FFF;
    this.checkIrq();
  }

  readIF() { return this.if; }
  writeIF(val) {
    // Writing 1 clears the bit
    this.if &= ~val;
    this.checkIrq();
  }

  readIME() { return this.ime; }
  writeIME(val) {
    this.ime = val & 1;
    this.checkIrq();
  }
}
