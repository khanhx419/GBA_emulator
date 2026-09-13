// ARM7TDMI 32-bit RISC CPU Core (ARMv4T architecture)

export const MODE_USR = 0x10;
export const MODE_FIQ = 0x11;
export const MODE_IRQ = 0x12;
export const MODE_SVC = 0x13;
export const MODE_ABT = 0x17;
export const MODE_UND = 0x1B;
export const MODE_SYS = 0x1F;

export const FLAG_N = 0x80000000;
export const FLAG_Z = 0x40000000;
export const FLAG_C = 0x20000000;
export const FLAG_V = 0x10000000;
export const FLAG_I = 0x00000080;
export const FLAG_F = 0x00000040;
export const FLAG_T = 0x00000020;

export class ARM7TDMI {
  constructor(gba) {
    this.gba = gba;

    // Registers: R0 - R15 (R15 = PC, R14 = LR, R13 = SP)
    this.gpr = new Int32Array(16);
    this.cpsr = MODE_SYS;

    // Banked Registers
    this.r13_bank = new Int32Array(6); // USR/SYS, FIQ, IRQ, SVC, ABT, UND
    this.r14_bank = new Int32Array(6);
    this.spsr_bank = new Int32Array(6);
    this.r8_12_fiq = new Int32Array(5);
    this.r8_12_usr = new Int32Array(5);

    this.halted = false;
    this.stopped = false;
    this.waitingIrq = 0;
    this.cycles = 0;
  }

  reset() {
    this.gpr.fill(0);
    this.r13_bank.fill(0);
    this.r14_bank.fill(0);
    this.spsr_bank.fill(0);
    this.r8_12_fiq.fill(0);
    this.r8_12_usr.fill(0);

    // Initial state after GBA BIOS boot
    this.cpsr = MODE_SYS;
    this.gpr[13] = 0x03007F00; // SP
    this.r13_bank[2] = 0x03007FA0; // IRQ SP
    this.r13_bank[3] = 0x03007FE0; // SVC SP
    this.gpr[15] = 0x08000000; // PC pointing to ROM start

    this.halted = false;
    this.stopped = false;
    this.waitingIrq = 0;
    this.cycles = 0;
  }

  triggerIrq() {
    if ((this.cpsr & FLAG_I) !== 0) return; // IRQs disabled in CPSR

    const oldCpsr = this.cpsr;
    const oldPc = (this.cpsr & FLAG_T) ? (this.gpr[15] + 4) : this.gpr[15];

    this.switchMode(MODE_IRQ);
    this.spsr_bank[2] = oldCpsr;
    this.gpr[14] = oldPc; // LR_irq
    this.cpsr |= FLAG_I;  // Disable further IRQs
    this.cpsr &= ~FLAG_T; // Switch to ARM state
    this.gpr[15] = 0x00000018; // IRQ vector
    this.halted = false;
  }

  switchMode(newMode) {
    const curBank = this.getBankIndex(this.cpsr & 0x1F);
    const targetBank = this.getBankIndex(newMode);

    if (curBank === targetBank) {
      this.cpsr = (this.cpsr & ~0x1F) | (newMode & 0x1F);
      return;
    }

    // Save current banked registers
    this.r13_bank[curBank] = this.gpr[13];
    this.r14_bank[curBank] = this.gpr[14];

    // Load new banked registers
    this.gpr[13] = this.r13_bank[targetBank];
    this.gpr[14] = this.r14_bank[targetBank];

    this.cpsr = (this.cpsr & ~0x1F) | (newMode & 0x1F);
  }

  getBankIndex(mode) {
    switch (mode) {
      case MODE_USR:
      case MODE_SYS: return 0;
      case MODE_FIQ: return 1;
      case MODE_IRQ: return 2;
      case MODE_SVC: return 3;
      case MODE_ABT: return 4;
      case MODE_UND: return 5;
      default: return 0;
    }
  }

  checkCondition(cond) {
    const n = (this.cpsr & FLAG_N) !== 0;
    const z = (this.cpsr & FLAG_Z) !== 0;
    const c = (this.cpsr & FLAG_C) !== 0;
    const v = (this.cpsr & FLAG_V) !== 0;

    switch (cond) {
      case 0x0: return z;                   // EQ
      case 0x1: return !z;                  // NE
      case 0x2: return c;                   // CS / HS
      case 0x3: return !c;                  // CC / LO
      case 0x4: return n;                   // MI
      case 0x5: return !n;                  // PL
      case 0x6: return v;                   // VS
      case 0x7: return !v;                  // VC
      case 0x8: return c && !z;             // HI
      case 0x9: return !c || z;             // LS
      case 0xA: return n === v;             // GE
      case 0xB: return n !== v;             // LT
      case 0xC: return !z && (n === v);     // GT
      case 0xD: return z || (n !== v);      // LE
      case 0xE: return true;                // AL
      case 0xF: return false;               // NV
    }
  }

  step() {
    if (this.halted) {
      this.cycles = 1;
      return 1;
    }

    this.cycles = 1;
    const mmu = this.gba.mmu;

    if (this.cpsr & FLAG_T) {
      // THUMB Mode (16-bit)
      const pc = this.gpr[15] >>> 0;
      const inst = mmu.read16(pc);
      this.gpr[15] = (pc + 2) >>> 0;
      this.executeThumb(inst);
    } else {
      // ARM Mode (32-bit)
      const pc = this.gpr[15] >>> 0;
      const inst = mmu.read32(pc);
      this.gpr[15] = (pc + 4) >>> 0;
      this.executeArm(inst);
    }

    return this.cycles;
  }

  // --- ARM EXECUTION ---
  executeArm(inst) {
    const cond = (inst >>> 28);
    if (cond !== 0xE && !this.checkCondition(cond)) {
      return;
    }

    // Branch and Exchange (BX)
    if ((inst & 0x0FFFFFF0) === 0x012FFF10) {
      const rn = inst & 0x0F;
      const target = this.gpr[rn];
      if (target & 1) {
        this.cpsr |= FLAG_T;
        this.gpr[15] = (target & ~1) >>> 0;
      } else {
        this.cpsr &= ~FLAG_T;
        this.gpr[15] = (target & ~3) >>> 0;
      }
      return;
    }

    // Software Interrupt (SWI)
    if ((inst & 0x0F000000) === 0x0F000000) {
      const swiNum = (inst >>> 16) & 0xFF;
      this.gba.bios.handleSwi(swiNum);
      return;
    }

    // Branch (B) / Branch with Link (BL)
    if ((inst & 0x0E000000) === 0x0A000000) {
      const isBl = (inst & 0x01000000) !== 0;
      let offset = (inst & 0x00FFFFFF) << 8 >> 6; // Sign extend and shift by 2
      if (isBl) {
        this.gpr[14] = (this.gpr[15]) >>> 0; // Next PC
      }
      this.gpr[15] = (this.gpr[15] + 4 + offset) >>> 0;
      return;
    }

    // Data Processing (ALU)
    if ((inst & 0x0C000000) === 0x00000000) {
      this.executeArmDataProcessing(inst);
      return;
    }

    // Single Data Transfer (LDR, STR)
    if ((inst & 0x0C000000) === 0x04000000) {
      this.executeArmSingleDataTransfer(inst);
      return;
    }

    // Block Data Transfer (LDM, STM)
    if ((inst & 0x0E000000) === 0x08000000) {
      this.executeArmBlockDataTransfer(inst);
      return;
    }

    // Halfword / Signed Transfer
    if ((inst & 0x0E000090) === 0x00000090) {
      this.executeArmHalfwordTransfer(inst);
      return;
    }
  }

  executeArmDataProcessing(inst) {
    const isImm = (inst & 0x02000000) !== 0;
    const opcode = (inst >>> 21) & 0xF;
    const setFlags = (inst & 0x00100000) !== 0;
    const rn = (inst >>> 16) & 0xF;
    const rd = (inst >>> 12) & 0xF;

    let op2 = 0;
    let carryOut = (this.cpsr & FLAG_C) !== 0;

    if (isImm) {
      const imm = inst & 0xFF;
      const rot = ((inst >>> 8) & 0xF) * 2;
      op2 = this.ror(imm, rot);
      if (rot !== 0) carryOut = (op2 & 0x80000000) !== 0;
    } else {
      const rm = inst & 0x0F;
      op2 = this.gpr[rm];
      const shiftType = (inst >>> 5) & 3;
      const shiftAmount = (inst & 0x10) ? (this.gpr[(inst >>> 8) & 0xF] & 0xFF) : ((inst >>> 7) & 0x1F);
      op2 = this.applyShift(op2, shiftType, shiftAmount);
    }

    const op1 = rn === 15 ? (this.gpr[15] + 4) : this.gpr[rn];
    let result = 0;

    switch (opcode) {
      case 0x0: result = op1 & op2; break;         // AND
      case 0x1: result = op1 ^ op2; break;         // EOR
      case 0x2: result = (op1 - op2) | 0; break;   // SUB
      case 0x3: result = (op2 - op1) | 0; break;   // RSB
      case 0x4: result = (op1 + op2) | 0; break;   // ADD
      case 0x5: result = (op1 + op2 + (carryOut ? 1 : 0)) | 0; break; // ADC
      case 0x6: result = (op1 - op2 - (carryOut ? 0 : 1)) | 0; break; // SBC
      case 0x7: result = (op2 - op1 - (carryOut ? 0 : 1)) | 0; break; // RSC
      case 0x8: setFlags && this.updateAluFlags(op1 & op2, op1, op2, true); return; // TST
      case 0x9: setFlags && this.updateAluFlags(op1 ^ op2, op1, op2, true); return; // TEQ
      case 0xA: setFlags && this.updateSubFlags(op1, op2, (op1 - op2) | 0); return;  // CMP
      case 0xB: setFlags && this.updateAddFlags(op1, op2, (op1 + op2) | 0); return;  // CMN
      case 0xC: result = op1 | op2; break;         // ORR
      case 0xD: result = op2; break;               // MOV
      case 0xE: result = op1 & ~op2; break;        // BIC
      case 0xF: result = ~op2; break;              // MVN
    }

    if (rd === 15) {
      this.gpr[15] = result >>> 0;
    } else {
      this.gpr[rd] = result;
    }

    if (setFlags) {
      this.updateAluFlags(result, op1, op2, false);
    }
  }

  executeArmSingleDataTransfer(inst) {
    const isImm = (inst & 0x02000000) === 0;
    const isPre = (inst & 0x01000000) !== 0;
    const isUp = (inst & 0x00800000) !== 0;
    const isByte = (inst & 0x00400000) !== 0;
    const writeBack = (inst & 0x00200000) !== 0 || !isPre;
    const isLoad = (inst & 0x00100000) !== 0;
    const rn = (inst >>> 16) & 0xF;
    const rd = (inst >>> 12) & 0xF;

    let offset = 0;
    if (isImm) {
      offset = inst & 0xFFF;
    } else {
      const rm = inst & 0x0F;
      offset = this.gpr[rm];
    }

    let base = rn === 15 ? (this.gpr[15] + 4) : this.gpr[rn];
    let addr = isPre ? (isUp ? base + offset : base - offset) : base;

    if (isLoad) {
      const val = isByte ? this.gba.mmu.read8(addr) : this.gba.mmu.read32(addr);
      this.gpr[rd] = val;
    } else {
      const val = rd === 15 ? (this.gpr[15] + 8) : this.gpr[rd];
      if (isByte) this.gba.mmu.write8(addr, val);
      else this.gba.mmu.write32(addr, val);
    }

    if (writeBack) {
      this.gpr[rn] = isPre ? addr : (isUp ? base + offset : base - offset);
    }
  }

  executeArmBlockDataTransfer(inst) {
    const isPre = (inst & 0x01000000) !== 0;
    const isUp = (inst & 0x00800000) !== 0;
    const writeBack = (inst & 0x00200000) !== 0;
    const isLoad = (inst & 0x00100000) !== 0;
    const rn = (inst >>> 16) & 0xF;
    const regList = inst & 0xFFFF;

    let addr = this.gpr[rn];
    const count = this.popCount(regList);

    let curAddr = isUp ? (isPre ? addr + 4 : addr) : (isPre ? addr - count * 4 : addr - count * 4 + 4);

    for (let i = 0; i < 16; i++) {
      if (regList & (1 << i)) {
        if (isLoad) {
          this.gpr[i] = this.gba.mmu.read32(curAddr);
        } else {
          this.gba.mmu.write32(curAddr, this.gpr[i]);
        }
        curAddr += 4;
      }
    }

    if (writeBack) {
      this.gpr[rn] = isUp ? addr + count * 4 : addr - count * 4;
    }
  }

  executeArmHalfwordTransfer(inst) {
    const isPre = (inst & 0x01000000) !== 0;
    const isUp = (inst & 0x00800000) !== 0;
    const isLoad = (inst & 0x00100000) !== 0;
    const isImm = (inst & 0x00400000) !== 0;
    const rn = (inst >>> 16) & 0xF;
    const rd = (inst >>> 12) & 0xF;
    const op = (inst >>> 5) & 3; // 1: unsigned half, 2: signed byte, 3: signed half

    let offset = isImm ? (((inst >>> 4) & 0xF0) | (inst & 0x0F)) : this.gpr[inst & 0x0F];
    let base = rn === 15 ? (this.gpr[15] + 4) : this.gpr[rn];
    let addr = isPre ? (isUp ? base + offset : base - offset) : base;

    if (isLoad) {
      if (op === 1) this.gpr[rd] = this.gba.mmu.read16(addr);
      else if (op === 2) this.gpr[rd] = (this.gba.mmu.read8(addr) << 24) >> 24;
      else if (op === 3) this.gpr[rd] = (this.gba.mmu.read16(addr) << 16) >> 16;
    } else {
      this.gba.mmu.write16(addr, this.gpr[rd]);
    }

    if ((inst & 0x00200000) || !isPre) {
      this.gpr[rn] = isPre ? addr : (isUp ? base + offset : base - offset);
    }
  }

  // --- THUMB EXECUTION ---
  executeThumb(inst) {
    const opcode = inst >>> 11;

    // Shift by immediate
    if (opcode <= 2) {
      const shiftOp = (inst >>> 11) & 3;
      const offset = (inst >>> 6) & 0x1F;
      const rs = (inst >>> 3) & 7;
      const rd = inst & 7;
      const val = this.applyShift(this.gpr[rs], shiftOp, offset);
      this.gpr[rd] = val;
      this.updateThumbFlags(val);
      return;
    }

    // Add / Subtract
    if (opcode === 3) {
      const isImm = (inst & 0x0400) !== 0;
      const isSub = (inst & 0x0200) !== 0;
      const op2 = isImm ? ((inst >>> 6) & 7) : this.gpr[(inst >>> 6) & 7];
      const rs = (inst >>> 3) & 7;
      const rd = inst & 7;
      const op1 = this.gpr[rs];
      const res = isSub ? (op1 - op2) | 0 : (op1 + op2) | 0;
      this.gpr[rd] = res;
      if (isSub) this.updateSubFlags(op1, op2, res);
      else this.updateAddFlags(op1, op2, res);
      return;
    }

    // Move / Compare / Add / Subtract Immediate
    if (opcode >= 4 && opcode <= 7) {
      const op = (inst >>> 11) & 3;
      const rd = (inst >>> 8) & 7;
      const imm = inst & 0xFF;
      const op1 = this.gpr[rd];
      if (op === 0) { // MOV
        this.gpr[rd] = imm;
        this.updateThumbFlags(imm);
      } else if (op === 1) { // CMP
        this.updateSubFlags(op1, imm, (op1 - imm) | 0);
      } else if (op === 2) { // ADD
        const res = (op1 + imm) | 0;
        this.gpr[rd] = res;
        this.updateAddFlags(op1, imm, res);
      } else if (op === 3) { // SUB
        const res = (op1 - imm) | 0;
        this.gpr[rd] = res;
        this.updateSubFlags(op1, imm, res);
      }
      return;
    }

    // ALU operations
    if ((inst >>> 10) === 0x10) {
      const aluOp = (inst >>> 6) & 0xF;
      const rs = (inst >>> 3) & 7;
      const rd = inst & 7;
      const valS = this.gpr[rs];
      const valD = this.gpr[rd];

      switch (aluOp) {
        case 0x0: this.gpr[rd] = valD & valS; this.updateThumbFlags(this.gpr[rd]); break; // AND
        case 0x1: this.gpr[rd] = valD ^ valS; this.updateThumbFlags(this.gpr[rd]); break; // EOR
        case 0x2: this.gpr[rd] = this.applyShift(valD, 0, valS & 0xFF); this.updateThumbFlags(this.gpr[rd]); break; // LSL
        case 0x3: this.gpr[rd] = this.applyShift(valD, 1, valS & 0xFF); this.updateThumbFlags(this.gpr[rd]); break; // LSR
        case 0x4: this.gpr[rd] = this.applyShift(valD, 2, valS & 0xFF); this.updateThumbFlags(this.gpr[rd]); break; // ASR
        case 0x5: this.gpr[rd] = (valD + valS + ((this.cpsr & FLAG_C) ? 1 : 0)) | 0; this.updateAddFlags(valD, valS, this.gpr[rd]); break; // ADC
        case 0x6: this.gpr[rd] = (valD - valS - ((this.cpsr & FLAG_C) ? 0 : 1)) | 0; this.updateSubFlags(valD, valS, this.gpr[rd]); break; // SBC
        case 0x7: this.gpr[rd] = this.applyShift(valD, 3, valS & 0xFF); this.updateThumbFlags(this.gpr[rd]); break; // ROR
        case 0x8: this.updateThumbFlags(valD & valS); break; // TST
        case 0x9: this.gpr[rd] = (-valS) | 0; this.updateSubFlags(0, valS, this.gpr[rd]); break; // NEG
        case 0xA: this.updateSubFlags(valD, valS, (valD - valS) | 0); break; // CMP
        case 0xB: this.updateAddFlags(valD, valS, (valD + valS) | 0); break; // CMN
        case 0xC: this.gpr[rd] = valD | valS; this.updateThumbFlags(this.gpr[rd]); break; // ORR
        case 0xD: this.gpr[rd] = (valD * valS) | 0; this.updateThumbFlags(this.gpr[rd]); break; // MUL
        case 0xE: this.gpr[rd] = valD & ~valS; this.updateThumbFlags(this.gpr[rd]); break; // BIC
        case 0xF: this.gpr[rd] = ~valS; this.updateThumbFlags(this.gpr[rd]); break; // MVN
      }
      return;
    }

    // Hi Register Operations / BX
    if ((inst >>> 10) === 0x11) {
      const op = (inst >>> 8) & 3;
      const h1 = (inst >>> 7) & 1;
      const h2 = (inst >>> 6) & 1;
      const rs = ((inst >>> 3) & 7) | (h2 << 3);
      const rd = (inst & 7) | (h1 << 3);

      if (op === 0) { // ADD
        this.gpr[rd] = (this.gpr[rd] + this.gpr[rs]) | 0;
      } else if (op === 1) { // CMP
        this.updateSubFlags(this.gpr[rd], this.gpr[rs], (this.gpr[rd] - this.gpr[rs]) | 0);
      } else if (op === 2) { // MOV
        this.gpr[rd] = this.gpr[rs];
      } else if (op === 3) { // BX
        const target = this.gpr[rs];
        if (target & 1) {
          this.gpr[15] = (target & ~1) >>> 0;
        } else {
          this.cpsr &= ~FLAG_T;
          this.gpr[15] = (target & ~3) >>> 0;
        }
      }
      return;
    }

    // LDR PC-relative
    if ((inst >>> 11) === 0x09) {
      const rd = (inst >>> 8) & 7;
      const imm = (inst & 0xFF) << 2;
      const addr = ((this.gpr[15] + 2) & ~3) + imm;
      this.gpr[rd] = this.gba.mmu.read32(addr);
      return;
    }

    // Load / Store with register offset
    if ((inst >>> 12) === 0x5) {
      const op = (inst >>> 9) & 7;
      const ro = (inst >>> 6) & 7;
      const rb = (inst >>> 3) & 7;
      const rd = inst & 7;
      const addr = this.gpr[rb] + this.gpr[ro];

      if (op === 0) this.gba.mmu.write32(addr, this.gpr[rd]); // STR
      else if (op === 1) this.gba.mmu.write16(addr, this.gpr[rd]); // STRH
      else if (op === 2) this.gba.mmu.write8(addr, this.gpr[rd]);  // STRB
      else if (op === 3) this.gpr[rd] = (this.gba.mmu.read8(addr) << 24) >> 24; // LDRSB
      else if (op === 4) this.gpr[rd] = this.gba.mmu.read32(addr); // LDR
      else if (op === 5) this.gpr[rd] = this.gba.mmu.read16(addr); // LDRH
      else if (op === 6) this.gpr[rd] = this.gba.mmu.read8(addr);  // LDRB
      else if (op === 7) this.gpr[rd] = (this.gba.mmu.read16(addr) << 16) >> 16; // LDRSH
      return;
    }

    // Load / Store with immediate offset
    if ((inst >>> 13) === 0x3) {
      const isByte = (inst & 0x1000) !== 0;
      const isLoad = (inst & 0x0800) !== 0;
      const offset = ((inst >>> 6) & 0x1F) << (isByte ? 0 : 2);
      const rb = (inst >>> 3) & 7;
      const rd = inst & 7;
      const addr = this.gpr[rb] + offset;

      if (isLoad) {
        this.gpr[rd] = isByte ? this.gba.mmu.read8(addr) : this.gba.mmu.read32(addr);
      } else {
        if (isByte) this.gba.mmu.write8(addr, this.gpr[rd]);
        else this.gba.mmu.write32(addr, this.gpr[rd]);
      }
      return;
    }

    // Load / Store Halfword
    if ((inst >>> 12) === 0x8) {
      const isLoad = (inst & 0x0800) !== 0;
      const offset = ((inst >>> 6) & 0x1F) << 1;
      const rb = (inst >>> 3) & 7;
      const rd = inst & 7;
      const addr = this.gpr[rb] + offset;

      if (isLoad) this.gpr[rd] = this.gba.mmu.read16(addr);
      else this.gba.mmu.write16(addr, this.gpr[rd]);
      return;
    }

    // SP-relative Load / Store
    if ((inst >>> 12) === 0x9) {
      const isLoad = (inst & 0x0800) !== 0;
      const rd = (inst >>> 8) & 7;
      const offset = (inst & 0xFF) << 2;
      const addr = this.gpr[13] + offset;

      if (isLoad) this.gpr[rd] = this.gba.mmu.read32(addr);
      else this.gba.mmu.write32(addr, this.gpr[rd]);
      return;
    }

    // Push / Pop
    if ((inst >>> 12) === 0xB && (inst & 0x0600) === 0x0400) {
      const isPop = (inst & 0x0800) !== 0;
      const pcLr = (inst & 0x0100) !== 0;
      const list = inst & 0xFF;

      if (isPop) {
        let sp = this.gpr[13];
        for (let i = 0; i < 8; i++) {
          if (list & (1 << i)) {
            this.gpr[i] = this.gba.mmu.read32(sp);
            sp += 4;
          }
        }
        if (pcLr) {
          const newPc = this.gba.mmu.read32(sp);
          sp += 4;
          if (newPc & 1) {
            this.gpr[15] = (newPc & ~1) >>> 0;
          } else {
            this.cpsr &= ~FLAG_T;
            this.gpr[15] = (newPc & ~3) >>> 0;
          }
        }
        this.gpr[13] = sp;
      } else {
        let sp = this.gpr[13];
        if (pcLr) {
          sp -= 4;
          this.gba.mmu.write32(sp, this.gpr[14]);
        }
        for (let i = 7; i >= 0; i--) {
          if (list & (1 << i)) {
            sp -= 4;
            this.gba.mmu.write32(sp, this.gpr[i]);
          }
        }
        this.gpr[13] = sp;
      }
      return;
    }

    // Conditional Branch
    if ((inst >>> 12) === 0xD) {
      const cond = (inst >>> 8) & 0xF;
      if (cond === 0xF) { // SWI
        const swiNum = inst & 0xFF;
        this.gba.bios.handleSwi(swiNum);
        return;
      }
      if (this.checkCondition(cond)) {
        const offset = (inst & 0xFF) << 24 >> 23; // Sign-extend 8-bit to shift 1
        this.gpr[15] = (this.gpr[15] + 2 + offset) >>> 0;
      }
      return;
    }

    // Unconditional Branch (B)
    if ((inst >>> 11) === 0x1C) {
      const offset = (inst & 0x7FF) << 21 >> 20; // Sign-extend 11-bit
      this.gpr[15] = (this.gpr[15] + 2 + offset) >>> 0;
      return;
    }

    // Long Branch with Link (BL)
    if ((inst >>> 12) === 0xF) {
      const isSecond = (inst & 0x0800) !== 0;
      const offset = inst & 0x7FF;

      if (!isSecond) {
        const signExt = (offset << 21) >> 9; // High 11 bits
        this.gpr[14] = (this.gpr[15] + 2 + signExt) >>> 0;
      } else {
        const target = (this.gpr[14] + (offset << 1)) >>> 0;
        this.gpr[14] = (this.gpr[15] | 1) >>> 0;
        this.gpr[15] = target;
      }
      return;
    }
  }

  // --- Helper Methods ---
  applyShift(val, type, amount) {
    if (amount === 0) return val;
    switch (type) {
      case 0: return (val << amount) | 0; // LSL
      case 1: return (val >>> amount) | 0; // LSR
      case 2: return (val >> amount) | 0;  // ASR
      case 3: return this.ror(val, amount); // ROR
    }
    return val;
  }

  ror(val, amount) {
    amount &= 31;
    return (val >>> amount) | (val << (32 - amount));
  }

  popCount(mask) {
    let count = 0;
    while (mask) {
      count += mask & 1;
      mask >>>= 1;
    }
    return count;
  }

  updateThumbFlags(val) {
    this.cpsr &= ~(FLAG_N | FLAG_Z);
    if (val < 0) this.cpsr |= FLAG_N;
    if (val === 0) this.cpsr |= FLAG_Z;
  }

  updateAluFlags(val, op1, op2, isLogical) {
    this.cpsr &= ~(FLAG_N | FLAG_Z);
    if (val < 0) this.cpsr |= FLAG_N;
    if (val === 0) this.cpsr |= FLAG_Z;
  }

  updateAddFlags(op1, op2, res) {
    this.cpsr &= ~(FLAG_N | FLAG_Z | FLAG_C | FLAG_V);
    if (res < 0) this.cpsr |= FLAG_N;
    if (res === 0) this.cpsr |= FLAG_Z;
    if ((op1 >>> 0) + (op2 >>> 0) > 0xFFFFFFFF) this.cpsr |= FLAG_C;
    if ((~(op1 ^ op2) & (op1 ^ res)) < 0) this.cpsr |= FLAG_V;
  }

  updateSubFlags(op1, op2, res) {
    this.cpsr &= ~(FLAG_N | FLAG_Z | FLAG_C | FLAG_V);
    if (res < 0) this.cpsr |= FLAG_N;
    if (res === 0) this.cpsr |= FLAG_Z;
    if ((op1 >>> 0) >= (op2 >>> 0)) this.cpsr |= FLAG_C;
    if (((op1 ^ op2) & (op1 ^ res)) < 0) this.cpsr |= FLAG_V;
  }
}
