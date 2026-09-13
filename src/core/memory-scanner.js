// Memory Scanner for GBA Memory (EWRAM 0x02000000 256KB, IWRAM 0x03000000 32KB)

export class GBAMemoryScanner {
  constructor(gba) {
    this.gba = gba;
    this.results = []; // Array of { address, value, formattedAddr }
    this.frozenAddresses = new Map(); // address -> { value, type, name }
    this.valueType = 'u16'; // 'u8', 'u16', 'u32'
    this.compareType = 'exact'; // 'exact', 'increased', 'decreased', 'changed', 'unchanged'
    this.lastSnapshot = null; // Uint8Array copy of memory for relative search
  }

  // Set active search data type
  setValueType(type) {
    this.valueType = type;
  }

  // Get total searchable memory buffer (EWRAM 256KB + IWRAM 32KB)
  getMemoryByte(addr) {
    const mmu = this.gba.mmu;
    if (addr >= 0x02000000 && addr < 0x02040000) {
      return mmu.ewram[addr - 0x02000000];
    } else if (addr >= 0x03000000 && addr < 0x03008000) {
      return mmu.iwram[addr - 0x03000000];
    }
    return 0;
  }

  readValue(addr, type = this.valueType) {
    const mmu = this.gba.mmu;
    if (type === 'u8') {
      return mmu.read8(addr);
    } else if (type === 'u16') {
      return mmu.read16(addr);
    } else if (type === 'u32') {
      return mmu.read32(addr);
    }
    return 0;
  }

  writeValue(addr, val, type = this.valueType) {
    const mmu = this.gba.mmu;
    val = Number(val);
    if (type === 'u8') {
      mmu.write8(addr, val & 0xFF);
    } else if (type === 'u16') {
      mmu.write16(addr, val & 0xFFFF);
    } else if (type === 'u32') {
      mmu.write32(addr, val >>> 0);
    }
  }

  // First search: search across all EWRAM & IWRAM
  searchFirst(targetVal) {
    targetVal = Number(targetVal);
    const mmu = this.gba.mmu;
    if (!mmu) return [];

    const matches = [];
    const step = this.valueType === 'u8' ? 1 : (this.valueType === 'u16' ? 2 : 4);

    // 1. Scan EWRAM (0x02000000 - 0x02040000, 256KB)
    for (let offset = 0; offset < 0x040000; offset += step) {
      const addr = 0x02000000 + offset;
      const currentVal = this.readValue(addr, this.valueType);
      if (currentVal === targetVal) {
        matches.push({
          address: addr,
          value: currentVal,
          formattedAddr: '0x' + addr.toString(16).padStart(8, '0').toUpperCase()
        });
        if (matches.length >= 5000) break; // limit for memory/performance
      }
    }

    // 2. Scan IWRAM (0x03000000 - 0x03008000, 32KB)
    if (matches.length < 5000) {
      for (let offset = 0; offset < 0x008000; offset += step) {
        const addr = 0x03000000 + offset;
        const currentVal = this.readValue(addr, this.valueType);
        if (currentVal === targetVal) {
          matches.push({
            address: addr,
            value: currentVal,
            formattedAddr: '0x' + addr.toString(16).padStart(8, '0').toUpperCase()
          });
          if (matches.length >= 5000) break;
        }
      }
    }

    this.results = matches;
    return this.results;
  }

  // Next search: filter down previous results
  searchNext(targetVal) {
    targetVal = Number(targetVal);
    const newResults = [];

    for (const item of this.results) {
      const currentVal = this.readValue(item.address, this.valueType);
      if (currentVal === targetVal) {
        newResults.push({
          address: item.address,
          value: currentVal,
          formattedAddr: item.formattedAddr
        });
      }
    }

    this.results = newResults;
    return this.results;
  }

  // Freeze an address to a fixed value
  freezeAddress(addr, val, name = 'Frozen Value') {
    this.frozenAddresses.set(addr, {
      value: Number(val),
      type: this.valueType,
      name
    });
  }

  // Unfreeze
  unfreezeAddress(addr) {
    this.frozenAddresses.delete(addr);
  }

  // Apply all frozen values - called every frame
  applyFrozen() {
    if (this.frozenAddresses.size === 0) return;
    for (const [addr, item] of this.frozenAddresses.entries()) {
      this.writeValue(addr, item.value, item.type);
    }
  }

  reset() {
    this.results = [];
    this.lastSnapshot = null;
  }
}
