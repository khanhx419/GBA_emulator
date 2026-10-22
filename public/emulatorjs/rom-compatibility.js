(() => {
  const originalCrc32 = 0xfba55dd8;
  const fixedCrc32 = 0x4085ae7b;
  const branchOffset = 0x0cecc8;
  const signature = [0xa3, 0xf7, 0x8e, 0xfb, 0x00, 0x06, 0x00, 0x28, 0x01, 0xd1, 0x00, 0xf0, 0x2d, 0xfc];
  const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
  });

  function crc32(bytes) {
    let value = 0xffffffff;
    for (let index = 0; index < bytes.length; index++) value = crcTable[(value ^ bytes[index]) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function prepareRom(bytes) {
    if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1) throw new TypeError('Invalid ROM buffer');
    const result = { bytes, compatibilityId: null, sourceCrc32: null, runtimeCrc32: null };
    if (bytes.byteLength !== 0x2000000) return result;
    const signatureOffset = branchOffset - 8;
    const matches = signature.every((value, index) => bytes[signatureOffset + index] === value);
    const alreadyFixed = signature.every((value, index) => bytes[signatureOffset + index] === (index === 9 ? 0xe0 : value));
    if (!matches && !alreadyFixed) return result;
    const checksum = crc32(bytes);
    if ((matches && checksum !== originalCrc32) || (alreadyFixed && checksum !== fixedCrc32)) return result;
    const patched = matches ? new Uint8Array(bytes) : bytes;
    if (matches) patched[branchOffset + 1] = 0xe0;
    return { bytes: patched, compatibilityId: 'radical-red-4.1-evolution-audio-wait',
      sourceCrc32: checksum, runtimeCrc32: fixedCrc32 };
  }

  function prepareState(bytes, targetCrc32) {
    const memory = globalThis.GBAKMemory.stateMemory(bytes);
    if (!memory) throw new Error('State không hợp lệ.');
    if (targetCrc32 === null || targetCrc32 === undefined || memory.romCrc32 === targetCrc32) return bytes;
    if (memory.romCrc32 !== originalCrc32 || targetCrc32 !== fixedCrc32) throw new Error('State thuộc phiên bản ROM khác.');
    const adapted = new Uint8Array(bytes);
    new DataView(adapted.buffer).setUint32(memory.stateOffset + 8, fixedCrc32, true);
    return adapted;
  }

  globalThis.GBAKCompatibility = { prepareRom, prepareState };
})();
