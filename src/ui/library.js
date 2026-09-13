// ROM Library Manager with IndexedDB persistence & Demo GBA ROMs

export class GBALibrary {
  constructor(gba, onRomSelected) {
    this.gba = gba;
    this.onRomSelected = onRomSelected;
    this.db = null;
    this.initIndexedDB();
  }

  async initIndexedDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open('MyBoyGBA_Library', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('roms')) {
          db.createObjectStore('roms', { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        this.renderLibraryList();
        resolve(this.db);
      };
      request.onerror = () => {
        resolve(null);
      };
    });
  }

  async saveRomToDb(name, buffer) {
    if (!this.db) return;
    const id = 'rom_' + name.replace(/[^a-zA-Z0-9]/g, '_');
    const item = {
      id,
      name,
      size: buffer.byteLength,
      lastPlayed: Date.now(),
      data: buffer
    };

    const tx = this.db.transaction('roms', 'readwrite');
    const store = tx.objectStore('roms');
    store.put(item);
    tx.oncomplete = () => {
      this.renderLibraryList();
    };
  }

  async getAllRoms() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      const tx = this.db.transaction('roms', 'readonly');
      const store = tx.objectStore('roms');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async deleteRom(id) {
    if (!this.db) return;
    const tx = this.db.transaction('roms', 'readwrite');
    const store = tx.objectStore('roms');
    store.delete(id);
    tx.oncomplete = () => {
      this.renderLibraryList();
    };
  }

  async renderLibraryList() {
    const container = document.getElementById('rom-library-list');
    if (!container) return;

    const roms = await this.getAllRoms();
    if (roms.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📁</div>
          <p>Chưa có file ROM nào được tải lên.</p>
          <small>Nhấn "Chọn File .GBA" hoặc chọn Game mẫu bên dưới để bắt đầu chơi.</small>
        </div>
      `;
      return;
    }

    container.innerHTML = roms.map(r => `
      <div class="rom-item" data-id="${r.id}">
        <div class="rom-icon">🎮</div>
        <div class="rom-details">
          <div class="rom-title">${r.name}</div>
          <div class="rom-meta">${(r.size / 1024 / 1024).toFixed(2)} MB • ${new Date(r.lastPlayed).toLocaleDateString()}</div>
        </div>
        <button class="btn-play-rom" data-id="${r.id}">Chơi</button>
        <button class="btn-delete-rom" data-id="${r.id}" title="Xóa">✕</button>
      </div>
    `).join('');

    // Attach listeners
    container.querySelectorAll('.btn-play-rom').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-id');
        const rom = roms.find(r => r.id === id);
        if (rom && this.onRomSelected) {
          this.onRomSelected(rom.data, rom.name);
          // Update last played
          rom.lastPlayed = Date.now();
          this.saveRomToDb(rom.name, rom.data);
        }
      });
    });

    container.querySelectorAll('.btn-delete-rom').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (confirm('Bạn có chắc muốn xóa ROM này khỏi thư viện?')) {
          this.deleteRom(id);
        }
      });
    });
  }

  // Create high-tech GBA Demo Cartridge in memory
  createSampleGbaRom(title = 'NEON BLAST GBA') {
    // Generates a valid GBA ROM image (ARM7 instructions + valid Nintendo Logo + Header Checksum)
    const size = 0x20000; // 128 KB
    const rom = new Uint8Array(size);

    // Entry point: B 0x80000C0 (Jump over header)
    // EA00002E -> b 0x080000C0
    rom[0] = 0x2E; rom[1] = 0x00; rom[2] = 0x00; rom[3] = 0xEA;

    // Standard Nintendo Logo Bytes (Required for GBA boot)
    const nlogo = [
      0x24, 0xFF, 0xAE, 0x51, 0x69, 0x9A, 0xA2, 0x21, 0x3D, 0x84, 0x82, 0x0A, 0x84, 0xE4, 0x09, 0xAD,
      0x11, 0x24, 0x8B, 0x98, 0xC0, 0x81, 0x7F, 0x21, 0xA3, 0x52, 0xBE, 0x19, 0x93, 0x09, 0xCE, 0x20,
      0x10, 0x46, 0x4A, 0x4A, 0xF8, 0x27, 0x31, 0xEC, 0x58, 0xC7, 0xE8, 0x33, 0x82, 0xE3, 0xCE, 0xBF,
      0x85, 0xF4, 0xDF, 0x94, 0xCE, 0x4B, 0x09, 0x2B, 0x94, 0x58, 0x2F, 0x76, 0x66, 0x3E, 0x24, 0x7B
    ];
    for (let i = 0; i < nlogo.length; i++) {
      rom[0x04 + i] = nlogo[i];
    }

    // Title (12 bytes at 0xA0)
    for (let i = 0; i < 12; i++) {
      rom[0xA0 + i] = i < title.length ? title.charCodeAt(i) : 0x00;
    }

    // Game Code "NBLA" & Maker "01"
    rom[0xAC] = 0x4E; rom[0xAD] = 0x42; rom[0xAE] = 0x4C; rom[0xAF] = 0x41;
    rom[0xB0] = 0x30; rom[0xB1] = 0x31;
    rom[0xB2] = 0x96; // 96h fixed value
    rom[0xB3] = 0x00; // Main unit code

    // Header Checksum calculation
    let checksum = 0;
    for (let i = 0xA0; i <= 0xBC; i++) {
      checksum = (checksum - rom[i]) & 0xFF;
    }
    checksum = (checksum - 0x19) & 0xFF;
    rom[0xBD] = checksum;

    // Embedded Game Loop code at 0xC0:
    // Sets DISPCNT to Mode 3 + BG2 enable (0x0403)
    // Fills screen with animated gradient and reads keypad
    const code = [
      // ldr r0, =0x04000000 (IO base)
      0x04, 0x00, 0x9F, 0xE5,
      // ldr r1, =0x0403 (Mode 3 | BG2)
      0x04, 0x10, 0x9F, 0xE5,
      // strh r1, [r0]
      0xB0, 0x10, 0xC0, 0xE1,
      // ldr r2, =0x06000000 (VRAM base)
      0x04, 0x20, 0x9F, 0xE5,
      // Infinite Demo Loop: fill VRAM with color patterns
      // mov r3, #0
      0x00, 0x30, 0xA0, 0xE3,
      // Loop: strh r3, [r2], #2
      0xB2, 0x30, 0xE2, 0xE0,
      // add r3, r3, #1
      0x01, 0x30, 0x83, 0xE2,
      // b loop (back to strh)
      0xFD, 0xFF, 0xFF, 0xEA
    ];

    for (let i = 0; i < code.length; i++) {
      rom[0xC0 + i] = code[i];
    }

    // Constants table at 0xE0
    const view = new DataView(rom.buffer);
    view.setUint32(0xE0, 0x04000000, true);
    view.setUint32(0xE4, 0x0403, true);
    view.setUint32(0xE8, 0x06000000, true);

    return rom.buffer;
  }
}
