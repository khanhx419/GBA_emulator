// ROM Library Manager with IndexedDB persistence, Local folder support & Demo GBA ROMs

export const PRELOADED_GAMES = [
  {
    title: 'Pokemon - Radical Red (v4.0)',
    fileName: 'Radical Red (v4.0).gba',
    url: '/game/Radical%20Red%20(v4.0).gba',
    size: '32.0 MB'
  }
];

export class GBALibrary {
  constructor(gba, onRomSelected) {
    this.gba = gba;
    this.onRomSelected = onRomSelected;
    this.db = null;
    this.initIndexedDB();
  }

  async initIndexedDB() {
    return new Promise((resolve) => {
      try {
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
      } catch (e) {
        resolve(null);
      }
    });
  }

  async saveRomToDb(name, buffer) {
    if (!this.db) return;
    try {
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
      tx.onerror = (e) => {
        console.warn('IndexedDB write error:', e);
      };
    } catch (e) {
      console.warn('Could not save ROM into IndexedDB:', e);
    }
  }

  async getAllRoms() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('roms', 'readonly');
        const store = tx.objectStore('roms');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async deleteRom(id) {
    if (!this.db) return;
    try {
      const tx = this.db.transaction('roms', 'readwrite');
      const store = tx.objectStore('roms');
      store.delete(id);
      tx.oncomplete = () => {
        this.renderLibraryList();
      };
    } catch (e) {}
  }

  async renderLibraryList() {
    const container = document.getElementById('rom-library-list');
    if (!container) return;

    // Render preloaded / local games section
    const preloadedContainer = document.getElementById('preloaded-games-list');
    if (preloadedContainer) {
      preloadedContainer.innerHTML = PRELOADED_GAMES.map(g => `
        <div class="rom-item" style="border-left: 3px solid var(--accent-cyan);">
          <div class="rom-icon">🔥</div>
          <div class="rom-details">
            <div class="rom-title">${g.title}</div>
            <div class="rom-meta">${g.size} • Sẵn sàng trong thư mục /game</div>
          </div>
          <button class="btn-play-rom btn-load-url" data-url="${g.url}" data-name="${g.fileName}">▶ Chơi ngay</button>
        </div>
      `).join('');

      preloadedContainer.querySelectorAll('.btn-load-url').forEach(btn => {
        btn.addEventListener('click', async () => {
          const url = btn.getAttribute('data-url');
          const name = btn.getAttribute('data-name');
          btn.textContent = '⏳ Đang tải...';
          btn.disabled = true;

          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Không thể tải file ROM');
            const buffer = await resp.arrayBuffer();
            this.saveRomToDb(name, buffer);
            if (this.onRomSelected) {
              this.onRomSelected(buffer, name);
            }
          } catch (err) {
            alert('Không tìm thấy file: ' + name + '\nHãy dùng nút "Chọn File .GBA" để chọn trực tiếp từ máy của bạn.');
          } finally {
            btn.textContent = '▶ Chơi ngay';
            btn.disabled = false;
          }
        });
      });
    }

    // Render user uploaded ROMs
    const roms = await this.getAllRoms();
    if (roms.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 10px; color: var(--text-dim); font-size: 0.8rem;">
          Chưa có file ROM nào được tải lên từ thiết bị.
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
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const rom = roms.find(r => r.id === id);
        if (rom && this.onRomSelected) {
          this.onRomSelected(rom.data, rom.name);
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
    const size = 0x20000; // 128 KB
    const rom = new Uint8Array(size);

    // Entry point: B 0x80000C0
    rom[0] = 0x2E; rom[1] = 0x00; rom[2] = 0x00; rom[3] = 0xEA;

    // Standard Nintendo Logo Bytes
    const nlogo = [
      0x24, 0xFF, 0xAE, 0x51, 0x69, 0x9A, 0xA2, 0x21, 0x3D, 0x84, 0x82, 0x0A, 0x84, 0xE4, 0x09, 0xAD,
      0x11, 0x24, 0x8B, 0x98, 0xC0, 0x81, 0x7F, 0x21, 0xA3, 0x52, 0xBE, 0x19, 0x93, 0x09, 0xCE, 0x20,
      0x10, 0x46, 0x4A, 0x4A, 0xF8, 0x27, 0x31, 0xEC, 0x58, 0xC7, 0xE8, 0x33, 0x82, 0xE3, 0xCE, 0xBF,
      0x85, 0xF4, 0xDF, 0x94, 0xCE, 0x4B, 0x09, 0x2B, 0x94, 0x58, 0x2F, 0x76, 0x66, 0x3E, 0x24, 0x7B
    ];
    for (let i = 0; i < nlogo.length; i++) {
      rom[0x04 + i] = nlogo[i];
    }

    // Title
    for (let i = 0; i < 12; i++) {
      rom[0xA0 + i] = i < title.length ? title.charCodeAt(i) : 0x00;
    }

    // Game Code & Maker
    rom[0xAC] = 0x4E; rom[0xAD] = 0x42; rom[0xAE] = 0x4C; rom[0xAF] = 0x41;
    rom[0xB0] = 0x30; rom[0xB1] = 0x31;
    rom[0xB2] = 0x96;
    rom[0xB3] = 0x00;

    // Header Checksum
    let checksum = 0;
    for (let i = 0xA0; i <= 0xBC; i++) {
      checksum = (checksum - rom[i]) & 0xFF;
    }
    checksum = (checksum - 0x19) & 0xFF;
    rom[0xBD] = checksum;

    // Embedded Game Loop code at 0xC0
    const code = [
      0x04, 0x00, 0x9F, 0xE5,
      0x04, 0x10, 0x9F, 0xE5,
      0xB0, 0x10, 0xC0, 0xE1,
      0x04, 0x20, 0x9F, 0xE5,
      0x00, 0x30, 0xA0, 0xE3,
      0xB2, 0x30, 0xE2, 0xE0,
      0x01, 0x30, 0x83, 0xE2,
      0xFD, 0xFF, 0xFF, 0xEA
    ];

    for (let i = 0; i < code.length; i++) {
      rom[0xC0 + i] = code[i];
    }

    const view = new DataView(rom.buffer);
    view.setUint32(0xE0, 0x04000000, true);
    view.setUint32(0xE4, 0x0403, true);
    view.setUint32(0xE8, 0x06000000, true);

    return rom.buffer;
  }
}
