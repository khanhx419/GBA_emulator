/**
 * SaveStateManager — Robust, high-capacity Save State management using IndexedDB.
 * 
 * Replaces restrictive ~5MB browser localStorage with gigabyte-capacity IndexedDB:
 * - Stores raw Uint8Array buffers directly (no JSON.stringify expansion or 5MB quota limit)
 * - Seamlessly supports unlimited slots (Slot 1, 2, 3, 4, 5, 6+)
 * - Instant synchronous metadata cache for UI thumbnails and timestamps
 * - Automatic migration of legacy localStorage saves into IndexedDB
 */

export class SaveStateManager {
  constructor() {
    this.dbName = 'GBA_K_SaveStates';
    this.dbVersion = 1;
    this.db = null;
    this._metaCache = new Map(); // key -> { timestamp, screenshot }
    this._initPromise = this.init();
  }

  async init() {
    return new Promise((resolve) => {
      try {
        if (!window.indexedDB) {
          console.warn('[SaveStateManager] IndexedDB not available, falling back to storage shim');
          resolve(null);
          return;
        }

        const req = indexedDB.open(this.dbName, this.dbVersion);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('states')) {
            db.createObjectStore('states', { keyPath: 'key' });
          }
        };
        req.onsuccess = async (e) => {
          this.db = e.target.result;
          this.db.onversionchange = () => { this.db?.close(); this.db = null; };
          try { await this._loadAllMeta(); } catch (error) {}
          resolve(this.db);
        };
        req.onerror = (e) => {
          console.warn('[SaveStateManager] IndexedDB open error:', e);
          resolve(null);
        };
        req.onblocked = () => resolve(null);
      } catch (err) {
        console.warn('[SaveStateManager] IndexedDB initialization failed:', err);
        resolve(null);
      }
    });
  }

  _getKey(romTitle, slot) {
    const safeTitle = (romTitle || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `state_${safeTitle}_slot${slot}`;
  }

  async _loadAllMeta() {
    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('states', 'readonly');
        tx.onabort = tx.onerror = () => resolve();
        const store = tx.objectStore('states');
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const val = cursor.value;
            this._metaCache.set(val.key, {
              timestamp: val.timestamp,
              screenshot: val.screenshot
            });
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  async saveState(romTitle, slot, stateData, screenshot, timestamp = Date.now()) {
    await this._initPromise;
    if (typeof romTitle !== 'string' || !romTitle || !Number.isSafeInteger(slot) || slot < 1 || slot > 999) return null;
    const bytes = stateData instanceof Uint8Array ? new Uint8Array(stateData) : new Uint8Array(stateData);
    if (!bytes.length || bytes.length > 16 * 1024 * 1024) return null;
    const key = this._getKey(romTitle, slot);
    const meta = {
      timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
      screenshot: this._safeScreenshot(screenshot)
    };

    // Update in-memory cache for instant UI response

    // 1. Primary: Save to IndexedDB (virtually unlimited quota)
    if (this.db) {
      const saved = await new Promise((resolve) => {
        try {
          const tx = this.db.transaction('states', 'readwrite');
          const store = tx.objectStore('states');
          const u8 = bytes;
          const item = {
            key,
            romTitle,
            slot,
            timestamp: meta.timestamp,
            screenshot: meta.screenshot,
            state: u8
          };
          const putReq = store.put(item);
          tx.oncomplete = () => resolve(true);
          tx.onabort = tx.onerror = () => resolve(false);
          putReq.onerror = (err) => {
            console.warn('[SaveStateManager] IndexedDB put error:', err);
            resolve(false);
          };
        } catch (e) {
          console.warn('[SaveStateManager] Transaction error:', e);
          resolve(false);
        }
      });

      if (saved) {
        this._metaCache.set(key, meta);
        // Clean up legacy localStorage if present to free space
        try {
          localStorage.removeItem(`myboy_savestate_${romTitle}_slot${slot}`);
        } catch (e) {}
        return { key, ...meta, state: stateData };
      }
      return null;
    }

    // 2. Fallback to localStorage only if IndexedDB is unavailable
    try {
      const stateObj = {
        version: 2,
        romTitle,
        timestamp: meta.timestamp,
        screenshot: meta.screenshot,
        state: Array.from(bytes)
      };
      localStorage.setItem(`myboy_savestate_${romTitle}_slot${slot}`, JSON.stringify(stateObj));
      this._metaCache.set(key, meta);
      return stateObj;
    } catch (e) {
      console.warn('[SaveStateManager] LocalStorage quota exceeded:', e);
      return null;
    }
  }

  async loadState(romTitle, slot) {
    await this._initPromise;
    const key = this._getKey(romTitle, slot);

    // 1. Check IndexedDB
    if (this.db) {
      const res = await new Promise((resolve) => {
        try {
          const tx = this.db.transaction('states', 'readonly');
          const store = tx.objectStore('states');
          const req = store.get(key);
          req.onsuccess = (e) => resolve(e.target.result || null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
      if (res && res.state) {
        const u8 = res.state instanceof Uint8Array ? res.state : new Uint8Array(res.state);
        return {
          state: u8,
          timestamp: res.timestamp,
          screenshot: res.screenshot
        };
      }
    }

    // 2. Check legacy localStorage fallback and migrate
    try {
      const json = localStorage.getItem(`myboy_savestate_${romTitle}_slot${slot}`);
      if (json) {
        const parsed = JSON.parse(json);
        if (parsed.state) {
          const u8 = new Uint8Array(parsed.state);
          // Auto-migrate to IndexedDB
          this.saveState(romTitle, slot, u8, parsed.screenshot, parsed.timestamp).catch(() => {});
          return {
            state: u8,
            timestamp: parsed.timestamp,
            screenshot: parsed.screenshot
          };
        }
      }
    } catch (e) {}

    return null;
  }

  getStateInfo(romTitle, slot) {
    const key = this._getKey(romTitle, slot);
    if (this._metaCache.has(key)) {
      return this._metaCache.get(key);
    }

    // Fallback: check legacy localStorage
    try {
      const json = localStorage.getItem(`myboy_savestate_${romTitle}_slot${slot}`);
      if (json) {
        const parsed = JSON.parse(json);
        const meta = { timestamp: parsed.timestamp, screenshot: parsed.screenshot };
        this._metaCache.set(key, meta);
        return meta;
      }
    } catch (e) {}

    return null;
  }

  async deleteState(romTitle, slot) {
    await this._initPromise;
    const key = this._getKey(romTitle, slot);

    if (this.db) {
      const deleted = await new Promise((resolve) => {
        try {
          const tx = this.db.transaction('states', 'readwrite');
          const store = tx.objectStore('states');
          const req = store.delete(key);
          tx.oncomplete = () => resolve(true);
          tx.onabort = tx.onerror = () => resolve(false);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
      if (!deleted) return false;
    }

    try {
      localStorage.removeItem(`myboy_savestate_${romTitle}_slot${slot}`);
    } catch (e) { return false; }

    this._metaCache.delete(key);
    return true;
  }

  async deleteAllStates(romTitle) {
    await this._initPromise;
    const backup = await this.exportBackup(romTitle);
    let success = true;
    for (const item of backup.states) {
      if (!await this.deleteState(item.romTitle, item.slot)) success = false;
    }
    return success;
  }

  async exportBackup(romTitle, batterySaveU8 = null) {
    await this._initPromise;
    const backup = {
      app: 'GBA_K',
      version: 2,
      timestamp: Date.now(),
      romTitle: romTitle || 'default',
      states: [],
      cheats: null,
      batterySaveBase64: null
    };

    if (batterySaveU8 && batterySaveU8.length > 0) {
      backup.batterySaveBase64 = this._uint8ToBase64(batterySaveU8);
    }

    // 1. Collect states from IndexedDB
    if (this.db) {
      await new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction('states', 'readonly');
          const store = tx.objectStore('states');
          const req = store.openCursor();
          req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const val = cursor.value;
              if (!romTitle || val.romTitle === romTitle) {
                backup.states.push({
                  key: val.key,
                  romTitle: val.romTitle,
                  slot: val.slot,
                  timestamp: val.timestamp,
                  screenshot: val.screenshot,
                  stateBase64: this._uint8ToBase64(val.state)
                });
              }
              cursor.continue();
            } else {
              resolve();
            }
          };
          tx.onabort = tx.onerror = () => reject(tx.error || new Error('Không đọc được các slot đã lưu.'));
          req.onerror = () => reject(req.error || new Error('Không đọc được các slot đã lưu.'));
        } catch (e) {
          reject(e);
        }
      });
    }

    try {
      const existingKeys = new Set(backup.states.map(item => item.key));
      for (let index = 0; index < localStorage.length; index++) {
        const storageKey = localStorage.key(index);
        const match = /^myboy_savestate_(.+)_slot(\d+)$/.exec(storageKey);
        if (!match || (romTitle && match[1] !== romTitle)) continue;
        const parsed = JSON.parse(localStorage.getItem(storageKey));
        const slot = Number(match[2]);
        const key = this._getKey(match[1], slot);
        if (!existingKeys.has(key) && Array.isArray(parsed.state) && parsed.state.length) {
          backup.states.push({ key, romTitle: match[1], slot, timestamp: parsed.timestamp,
            screenshot: parsed.screenshot, stateBase64: this._uint8ToBase64(parsed.state) });
        }
      }
    } catch (error) {}

    // 2. Include cheats
    try {
      const cheatKey = 'myboy_cheats_' + (romTitle || 'default');
      backup.cheats = localStorage.getItem(cheatKey);
    } catch (e) {}

    return backup;
  }

  async importBackup(backupData, expectedRomTitle = null, expectedRomCrc32 = null) {
    await this._initPromise;
    const data = typeof backupData === 'string' ? JSON.parse(backupData) : backupData;
    if (!data || data.app !== 'GBA_K' || data.version !== 2 || !Array.isArray(data.states) || data.states.length > 999) {
      throw new Error('Định dạng backup GBA_K không hợp lệ.');
    }
    if (expectedRomTitle && data.romTitle !== expectedRomTitle) throw new Error('Backup thuộc game khác.');
    const keys = new Set();
    const prepared = data.states.map(item => {
      if (!item || !Number.isSafeInteger(item.slot) || item.slot < 1 || item.slot > 999) throw new Error('Slot không hợp lệ.');
      const romTitle = item.romTitle || data.romTitle;
      if (typeof romTitle !== 'string' || !romTitle || (expectedRomTitle && romTitle !== expectedRomTitle)) throw new Error('Tên ROM không hợp lệ.');
      const key = this._getKey(romTitle, item.slot);
      if (keys.has(key)) throw new Error('Backup chứa slot trùng lặp.');
      keys.add(key);
      let state = this._base64ToUint8(item.stateBase64);
      if (!state.length || state.length > 16 * 1024 * 1024) throw new Error('Dữ liệu state không hợp lệ.');
      state = globalThis.GBAKCompatibility.prepareState(state, expectedRomCrc32);
      const memory = globalThis.GBAKMemory?.stateMemory(state);
      if (!memory || (expectedRomCrc32 !== null && memory.romCrc32 !== expectedRomCrc32)) throw new Error('State bị hỏng hoặc thuộc phiên bản ROM khác.');
      return { ...item, key, romTitle, state, screenshot: this._safeScreenshot(item.screenshot) };
    });
    const batterySave = data.batterySaveBase64 ? this._base64ToUint8(data.batterySaveBase64) : null;
    if (batterySave && (!batterySave.length || batterySave.length > 1024 * 1024)) throw new Error('Dữ liệu SAV không hợp lệ.');
    const cheats = typeof data.cheats === 'string' ? JSON.parse(data.cheats) : data.cheats;
    if (cheats != null && (!Array.isArray(cheats) || cheats.some(cheat => !cheat || typeof cheat.code !== 'string' || typeof cheat.id !== 'string'))) {
      throw new Error('Danh sách cheat không hợp lệ.');
    }

    let importedCount = 0;
    if (this.db && prepared.length) {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction('states', 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Không thể lưu backup.'));
        const store = transaction.objectStore('states');
        for (const item of prepared) store.put(item);
      });
      for (const item of prepared) {
        this._metaCache.set(item.key, { timestamp: item.timestamp, screenshot: item.screenshot });
        try { localStorage.removeItem(`myboy_savestate_${item.romTitle}_slot${item.slot}`); } catch (error) {}
      }
      importedCount = prepared.length;
    } else {
      const previous = new Map();
      try {
        for (const item of prepared) {
          const key = `myboy_savestate_${item.romTitle}_slot${item.slot}`;
          previous.set(key, localStorage.getItem(key));
          localStorage.setItem(key, JSON.stringify({ ...item, state: Array.from(item.state), version: 2 }));
        }
      } catch (error) {
        for (const [key, value] of previous) {
          try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (restoreError) {}
        }
        throw error;
      }
      for (const item of prepared) this._metaCache.set(item.key, { timestamp: item.timestamp, screenshot: item.screenshot });
      importedCount = prepared.length;
    }

    if (cheats && data.romTitle) {
      try {
        const key = 'myboy_cheats_' + (data.romTitle || 'default');
        localStorage.setItem(key, JSON.stringify(cheats));
      } catch (e) {}
    }

    return {
      count: importedCount,
      batterySave,
      romTitle: data.romTitle || 'game'
    };
  }

  _uint8ToBase64(u8) {
    const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    return btoa(binary);
  }

  _safeScreenshot(value) {
    return typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
  }

  _base64ToUint8(b64) {
    if (typeof b64 !== 'string' || !b64 || b64.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error('Dữ liệu base64 không hợp lệ.');
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

export const saveStateManager = new SaveStateManager();
