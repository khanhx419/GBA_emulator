/**
 * GBAMemoryScanner — High-Performance Memory Scanner & Cheat Engine for GBA.
 * 
 * Works seamlessly across both mGBA WebAssembly core and JavaScript engine:
 * - Direct snapshot buffer scanning for EWRAM (256KB) & IWRAM (32KB)
 * - Multiple comparison modes: Exact (=), Greater (>), Less (<), Unchanged (==), Changed (!=)
 * - Batch operations: Edit All, Freeze All, Generate Cheats, Clear
 * - Automatic CodeBreaker / GameShark cheat code generation
 */

export class GBAMemoryScanner {
  constructor(gba) {
    this.gba = gba;
    this.results = []; // Array of { address, value, prevValue, formattedAddr }
    this.frozenAddresses = new Map(); // address -> { value, type, name }
    this.valueType = 'u16'; // 'u8', 'u16', 'u32'
    this.compareType = 'exact'; // 'exact', 'greater', 'less', 'unchanged', 'changed'
    this.lastSnapshot = null; // Buffer snapshot for relative searches
  }

  setValueType(type) {
    this.valueType = type;
  }

  setCompareType(type) {
    this.compareType = type;
  }

  // Obtains a unified memory buffer snapshot for fast bulk scanning
  getMemoryBuffers() {
    // 1. WASM Adapter
    if (typeof this.gba.getMemorySnapshot === 'function') {
      const snap = this.gba.getMemorySnapshot();
      if (snap) {
        return {
          ewram: snap.ewram, // 256KB
          iwram: snap.iwram  // 32KB
        };
      }
    }

    // 2. JS MMU
    const mmu = this.gba.mmu;
    if (mmu && mmu.ewram && mmu.iwram) {
      return {
        ewram: mmu.ewram,
        iwram: mmu.iwram
      };
    }

    return null;
  }

  // Fast reading from a snapshot buffer
  readFromBuffers(buffers, addr, type = this.valueType) {
    if (!buffers) return 0;
    let buf = null;
    let offset = 0;

    if (addr >= 0x02000000 && addr < 0x02040000) {
      buf = buffers.ewram;
      offset = addr - 0x02000000;
    } else if (addr >= 0x03000000 && addr < 0x03008000) {
      buf = buffers.iwram;
      offset = addr - 0x03000000;
    }

    if (!buf || offset < 0 || offset >= buf.length) return 0;

    if (type === 'u8') {
      return buf[offset];
    } else if (type === 'u16') {
      return buf[offset] | (buf[offset + 1] << 8);
    } else if (type === 'u32') {
      return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
    }
    return 0;
  }

  // Live single-address read
  readValue(addr, type = this.valueType) {
    if (typeof this.gba.readMemory === 'function') {
      return this.gba.readMemory(addr, type);
    }
    const mmu = this.gba.mmu;
    if (!mmu) return 0;
    if (type === 'u8') return mmu.read8(addr);
    if (type === 'u16') return mmu.read16(addr);
    if (type === 'u32') return mmu.read32(addr);
    return 0;
  }

  // Live single-address write
  writeValue(addr, val, type = this.valueType) {
    val = Number(val);
    if (val > 65535 && type !== 'u32') {
      type = 'u32';
    }
    if (typeof this.gba.writeMemory === 'function') {
      return this.gba.writeMemory(addr, val, type);
    }
    const mmu = this.gba.mmu;
    if (!mmu) return false;
    if (type === 'u8') mmu.write8(addr, val & 0xFF);
    else if (type === 'u16') mmu.write16(addr, val & 0xFFFF);
    else if (type === 'u32') mmu.write32(addr, val >>> 0);
    return true;
  }

  // Save current memory buffers as lastSnapshot for relative searches
  saveSnapshot(buffers) {
    if (!buffers) return;
    this.lastSnapshot = {
      ewram: new Uint8Array(buffers.ewram),
      iwram: new Uint8Array(buffers.iwram)
    };
  }

  // First search: Scan across EWRAM (256KB) & IWRAM (32KB)
  searchFirst(targetVal) {
    const buffers = this.getMemoryBuffers();
    if (!buffers) return [];

    const numVal = targetVal !== '' && targetVal !== null && !isNaN(Number(targetVal)) ? Number(targetVal) : null;
    const matches = [];
    // For u32, use step = 2 so 2-byte aligned 32-bit numbers (common in packed GBA structs) are not missed
    const step = this.valueType === 'u8' ? 1 : 2;
    const mode = this.compareType;

    // Scan EWRAM (0x02000000, 256KB)
    for (let offset = 0; offset <= 0x040000 - step; offset += step) {
      const addr = 0x02000000 + offset;
      const val = this.readFromBuffers(buffers, addr, this.valueType);
      let match = false;

      if (mode === 'exact') {
        match = numVal !== null && val === numVal;
      } else if (mode === 'greater') {
        match = numVal !== null ? val > numVal : true;
      } else if (mode === 'less') {
        match = numVal !== null ? val < numVal : true;
      } else {
        // unchanged / changed initially captures snapshot
        match = true;
      }

      if (match) {
        matches.push({
          address: addr,
          value: val,
          prevValue: val,
          formattedAddr: '0x' + addr.toString(16).padStart(8, '0').toUpperCase()
        });
        if (matches.length >= 5000) break;
      }
    }

    // Scan IWRAM (0x03000000, 32KB)
    if (matches.length < 5000) {
      for (let offset = 0; offset <= 0x008000 - step; offset += step) {
        const addr = 0x03000000 + offset;
        const val = this.readFromBuffers(buffers, addr, this.valueType);
        let match = false;

        if (mode === 'exact') {
          match = numVal !== null && val === numVal;
        } else if (mode === 'greater') {
          match = numVal !== null ? val > numVal : true;
        } else if (mode === 'less') {
          match = numVal !== null ? val < numVal : true;
        } else {
          match = true;
        }

        if (match) {
          matches.push({
            address: addr,
            value: val,
            prevValue: val,
            formattedAddr: '0x' + addr.toString(16).padStart(8, '0').toUpperCase()
          });
          if (matches.length >= 5000) break;
        }
      }
    }

    this.results = matches;
    this.saveSnapshot(buffers);
    return this.results;
  }

  // Next search: Filter previous results
  searchNext(targetVal) {
    const buffers = this.getMemoryBuffers();
    if (!buffers) return this.results;

    const numVal = targetVal !== '' && targetVal !== null && !isNaN(Number(targetVal)) ? Number(targetVal) : null;
    const newResults = [];
    const mode = this.compareType;

    for (const item of this.results) {
      const currentVal = this.readFromBuffers(buffers, item.address, this.valueType);
      const prevVal = item.value;
      let match = false;

      if (mode === 'exact') {
        match = numVal !== null ? currentVal === numVal : currentVal === prevVal;
      } else if (mode === 'greater') {
        match = numVal !== null ? currentVal > numVal : currentVal > prevVal;
      } else if (mode === 'less') {
        match = numVal !== null ? currentVal < numVal : currentVal < prevVal;
      } else if (mode === 'unchanged') {
        match = currentVal === prevVal;
      } else if (mode === 'changed') {
        match = currentVal !== prevVal;
      }

      if (match) {
        newResults.push({
          address: item.address,
          value: currentVal,
          prevValue: prevVal,
          formattedAddr: item.formattedAddr
        });
      }
    }

    this.results = newResults;
    this.saveSnapshot(buffers);
    return this.results;
  }

  // Batch edit all found results
  editAll(newVal, type = this.valueType) {
    newVal = Number(newVal);
    if (newVal > 65535 && type !== 'u32') {
      type = 'u32';
    }
    for (const item of this.results) {
      this.writeValue(item.address, newVal, type);
      item.value = newVal;
    }
  }

  // Batch freeze all found results
  freezeAll(freezeVal = null) {
    for (const item of this.results) {
      const val = freezeVal !== null ? Number(freezeVal) : item.value;
      const type = val > 65535 ? 'u32' : this.valueType;
      this.writeValue(item.address, val, type);
      this.gba.addFreeze(item.address, val, type);
    }
  }

  // Generate GBA CodeBreaker / GameShark code for a given address
  generateCheatCode(addr, val, type = this.valueType) {
    val = Number(val);
    if (val > 65535 && type !== 'u32') {
      type = 'u32';
    }
    const isEwram = (addr >= 0x02000000 && addr < 0x02040000);
    const isIwram = (addr >= 0x03000000 && addr < 0x03008000);
    if (!isEwram && !isIwram) return null;

    const prefix = isEwram ? '82' : '83';
    const bytePrefix = isEwram ? '32' : '33';
    const off = (addr & 0x00FFFFFF).toString(16).padStart(6, '0').toUpperCase();

    if (type === 'u8') {
      const hexVal = (val & 0xFF).toString(16).padStart(2, '0').toUpperCase();
      return `${bytePrefix}${off} 00${hexVal}`;
    }
    if (type === 'u32') {
      const off2 = ((addr + 2) & 0x00FFFFFF).toString(16).padStart(6, '0').toUpperCase();
      const low16 = (val & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
      const high16 = ((val >>> 16) & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
      return `${prefix}${off} ${low16}\n${prefix}${off2} ${high16}`;
    }
    const hexVal = (val & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
    return `${prefix}${off} ${hexVal}`;
  }

  // Create a cheat and add it directly to Cheat Manager
  createCheat(addr, val, name = null) {
    const type = Number(val) > 65535 ? 'u32' : this.valueType;
    const code = this.generateCheatCode(addr, val, type);
    if (!code) return false;
    const cheatName = name || `Cheat 0x${addr.toString(16).toUpperCase()}`;
    if (this.gba.cheats && this.gba.cheats.addCheat) {
      this.gba.cheats.addCheat(cheatName, code);
      return true;
    }
    return false;
  }

  // Batch create cheat codes for all results
  createCheatForAll(namePrefix = 'Batch Cheat') {
    const codes = [];
    for (const item of this.results.slice(0, 30)) {
      const line = this.generateCheatCode(item.address, item.value, this.valueType);
      if (line) codes.push(line);
    }
    if (codes.length > 0 && this.gba.cheats && this.gba.cheats.addCheat) {
      this.gba.cheats.addCheat(namePrefix, codes.join('\n'));
      return true;
    }
    return false;
  }

  reset() {
    this.results = [];
    this.lastSnapshot = null;
  }
}
