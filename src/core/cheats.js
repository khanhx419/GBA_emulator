// GBA Cheat Code Engine (GameShark / CodeBreaker / Action Replay / Raw)

export class GBACheats {
  constructor(gba) {
    this.gba = gba;
    this.cheats = []; // { id, name, type, code, enabled }
  }

  addCheat(name, code, type = 'RAW') {
    const id = 'cheat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const item = {
      id,
      name: name || 'Cheat #' + (this.cheats.length + 1),
      code: code.trim().toUpperCase(),
      type,
      enabled: true
    };
    this.cheats.push(item);
    this.saveToStorage();
    return item;
  }

  removeCheat(id) {
    this.cheats = this.cheats.filter(c => c.id !== id);
    this.saveToStorage();
  }

  toggleCheat(id, enabled) {
    const c = this.cheats.find(c => c.id === id);
    if (c) {
      c.enabled = enabled !== undefined ? enabled : !c.enabled;
      this.saveToStorage();
    }
  }

  applyCheats() {
    if (!this.cheats || this.cheats.length === 0) return;
    const mmu = this.gba.mmu;
    if (!mmu || !mmu.romSize) return;

    for (const item of this.cheats) {
      if (!item.enabled) continue;

      const lines = item.code.split(/[\r\n]+/);
      for (const rawLine of lines) {
        if (!rawLine.trim()) continue;
        const hexOnly = rawLine.trim().toUpperCase().replace(/[^0-9A-F]/g, '');

        if (hexOnly.length === 12) {
          const addrHex = hexOnly.substring(0, 8);
          const valHex = hexOnly.substring(8, 12);
          const addr = parseInt(addrHex, 16);
          const val = parseInt(valHex, 16);
          if (!isNaN(addr) && !isNaN(val)) {
            if (addrHex.startsWith('82') || addrHex.startsWith('02')) {
              mmu.write16(0x02000000 | (addr & 0x00FFFFFF), val);
            } else if (addrHex.startsWith('32')) {
              mmu.write8(0x02000000 | (addr & 0x00FFFFFF), val & 0xFF);
            } else if (addrHex.startsWith('83') || addrHex.startsWith('03')) {
              mmu.write16(0x03000000 | (addr & 0x00FFFFFF), val);
            } else if (addrHex.startsWith('33')) {
              mmu.write8(0x03000000 | (addr & 0x00FFFFFF), val & 0xFF);
            } else {
              mmu.write16(addr, val);
            }
          }
        } else if (hexOnly.length === 10) {
          const addrHex = hexOnly.substring(0, 8);
          const val = parseInt(hexOnly.substring(8, 10), 16);
          const addr = parseInt(addrHex, 16);
          if (!isNaN(addr) && !isNaN(val)) {
            if (addrHex.startsWith('03') || addrHex.startsWith('33')) {
              mmu.write8(0x03000000 | (addr & 0x00FFFFFF), val & 0xFF);
            } else {
              mmu.write8(0x02000000 | (addr & 0x00FFFFFF), val & 0xFF);
            }
          }
        } else if (hexOnly.length === 16) {
          const addrHex = hexOnly.substring(0, 8);
          const valHex = hexOnly.substring(8, 16);
          const addr = parseInt(addrHex, 16);
          const val = parseInt(valHex, 16);
          if (!isNaN(addr) && !isNaN(val)) {
            mmu.write32(addr, val);
          }
        }
      }
    }
  }

  saveToStorage() {
    try {
      const romTitle = this.gba.getRomTitle() || 'default_game';
      localStorage.setItem('myboy_cheats_' + romTitle, JSON.stringify(this.cheats));
    } catch (e) {}
  }

  loadFromStorage() {
    try {
      const romTitle = this.gba.getRomTitle() || 'default_game';
      const data = localStorage.getItem('myboy_cheats_' + romTitle);
      if (data) {
        this.cheats = JSON.parse(data);
      } else {
        this.cheats = [];
      }
    } catch (e) {
      this.cheats = [];
    }
  }
}
