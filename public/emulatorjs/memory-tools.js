(() => {
  function stateMemory(bytes) {
    if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1) return null;
    bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    if (bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 7)) === 'RASTATE') {
      offset = -1;
      for (let position = 8; position + 8 <= bytes.length;) {
        const length = view.getUint32(position + 4, true);
        if (length > bytes.length - position - 8) return null;
        const tag = String.fromCharCode(...bytes.subarray(position, position + 4));
        if (tag === 'MEM ') {
          offset = position + 8;
          if (length < 0x61000) return null;
          break;
        }
        if (tag === 'END ') break;
        position += 8 + Math.ceil(length / 8) * 8;
      }
    }
    if (offset < 0 || offset + 0x61000 > bytes.length) return null;
    const magic = view.getUint32(offset, true);
    if ((magic >>> 24) !== 1 || (magic & 0xffffff) > 0x100) return null;
    return {
      iwram: bytes.subarray(offset + 0x19000, offset + 0x21000),
      ewram: bytes.subarray(offset + 0x21000, offset + 0x61000),
      romCrc32: view.getUint32(offset + 8, true)
    };
  }

  function ramAccess(address, type, value) {
    const size = { u8: 1, u16: 2, u32: 4 }[type];
    if (!size || !Number.isInteger(address)) return null;
    const start = address >= 0x02000000 && address < 0x02040000 ? 0x02000000
      : address >= 0x03000000 && address < 0x03008000 ? 0x03000000 : null;
    if (start === null) return null;
    const length = start === 0x02000000 ? 0x40000 : 0x8000;
    if (address + size > start + length) return null;
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 2 ** (size * 8) - 1)) return null;
    return { size, offset: address - start, region: start === 0x02000000 ? 'ewram' : 'iwram' };
  }

  function normalizeCheat(rawLine) {
    if (typeof rawLine !== 'string') return null;
    const clean = rawLine.trim().toUpperCase();
    if (clean.includes('+')) {
      const lines = clean.split('+').map(normalizeCheat);
      return lines.length && lines.every(Boolean) ? lines.join('+') : null;
    }
    if (!clean || !/^[0-9A-F\s:=]+$/.test(clean)) return null;
    const compact = clean.replace(/[\s:=]/g, '');
    if (![10, 12, 16].includes(compact.length)) return null;
    let address = compact.slice(0, 8);
    let value = compact.slice(8);
    if (address.startsWith('02') || address.startsWith('03')) {
      const type = value.length === 2 ? 'u8' : value.length === 4 ? 'u16' : 'u32';
      if (!ramAccess(parseInt(address, 16), type, parseInt(value, 16))) return null;
      if (type === 'u32') {
        const prefix = address.startsWith('02') ? '82' : '83';
        const nextAddress = (parseInt(address, 16) + 2).toString(16).padStart(8, '0').toUpperCase();
        return `${prefix}${address.slice(2)} ${value.slice(4)}+${prefix}${nextAddress.slice(2)} ${value.slice(0, 4)}`;
      }
      address = (type === 'u8' ? '3' : '8') + address.slice(1);
    } else if (compact.length === 10 && !/^(32|33)/.test(address)) {
      return null;
    }
    if (value.length === 2) value = value.padStart(4, '0');
    if (value.length === 4 && /^(82|83|32|33)/.test(address)) {
      const rawAddress = parseInt('0' + address.slice(1), 16);
      if (!ramAccess(rawAddress, address.startsWith('3') ? 'u8' : 'u16', parseInt(value, 16))) return null;
    }
    return `${address} ${value}`;
  }

  function resolveBases(heap, state) {
    const memory = stateMemory(state);
    if (!memory || !(heap instanceof Uint8Array)) return null;
    let signature = -1;
    const iwram = memory.iwram;
    for (let offset = 0x100; offset + 16 <= iwram.length; offset += 4) {
      if (new Set(iwram.subarray(offset, offset + 16)).size >= 8) {
        signature = offset;
        break;
      }
    }
    if (signature < 0) return null;
    let result = null;
    for (let position = 0x40000 + signature; position + iwram.length - signature <= heap.length; position += 4) {
      if (heap[position] !== iwram[signature] || heap[position + 1] !== iwram[signature + 1]) continue;
      let matches = true;
      for (let index = 2; index < 16; index++) {
        if (heap[position + index] !== iwram[signature + index]) { matches = false; break; }
      }
      if (!matches) continue;
      const iwramBase = position - signature;
      const ewramBase = iwramBase - 0x40000;
      for (const [base, bytes] of [[iwramBase, iwram], [ewramBase, memory.ewram]]) {
        for (let index = 0; index < bytes.length; index++) {
          if (heap[base + index] !== bytes[index]) { matches = false; break; }
        }
        if (!matches) break;
      }
      if (!matches) continue;
      if (result) return null;
      result = { ewramBase, iwramBase };
    }
    return result;
  }

  globalThis.GBAKMemory = { stateMemory, ramAccess, normalizeCheat, resolveBases };
})();
