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
          await this._loadAllMeta();
          resolve(this.db);
        };
        req.onerror = (e) => {
          console.warn('[SaveStateManager] IndexedDB open error:', e);
          resolve(null);
        };
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

  async saveState(romTitle, slot, stateData, screenshot) {
    await this._initPromise;
    const key = this._getKey(romTitle, slot);
    const meta = {
      timestamp: Date.now(),
      screenshot: screenshot || null
    };

    // Update in-memory cache for instant UI response
    this._metaCache.set(key, meta);

    // 1. Primary: Save to IndexedDB (virtually unlimited quota)
    if (this.db) {
      const saved = await new Promise((resolve) => {
        try {
          const tx = this.db.transaction('states', 'readwrite');
          const store = tx.objectStore('states');
          const u8 = stateData instanceof Uint8Array ? stateData : new Uint8Array(stateData);
          const item = {
            key,
            romTitle,
            slot,
            timestamp: meta.timestamp,
            screenshot: meta.screenshot,
            state: u8
          };
          const putReq = store.put(item);
          putReq.onsuccess = () => resolve(true);
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
        // Clean up legacy localStorage if present to free space
        try {
          localStorage.removeItem(`myboy_savestate_${romTitle}_slot${slot}`);
        } catch (e) {}
        return { key, ...meta, state: stateData };
      }
    }

    // 2. Fallback to localStorage only if IndexedDB is unavailable
    try {
      const stateObj = {
        version: 2,
        romTitle,
        timestamp: meta.timestamp,
        screenshot: meta.screenshot,
        state: Array.from(stateData)
      };
      localStorage.setItem(`myboy_savestate_${romTitle}_slot${slot}`, JSON.stringify(stateObj));
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
          this.saveState(romTitle, slot, u8, parsed.screenshot).catch(() => {});
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
    this._metaCache.delete(key);

    if (this.db) {
      await new Promise((resolve) => {
        try {
          const tx = this.db.transaction('states', 'readwrite');
          const store = tx.objectStore('states');
          const req = store.delete(key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    }

    try {
      localStorage.removeItem(`myboy_savestate_${romTitle}_slot${slot}`);
    } catch (e) {}

    return true;
  }

  async deleteAllStates(romTitle) {
    await this._initPromise;
    for (let slot = 1; slot <= 10; slot++) {
      await this.deleteState(romTitle, slot);
    }
    return true;
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
      await new Promise((resolve) => {
        try {
          const tx = this.db.transaction('states', 'readonly');
          const store = tx.objectStore('states');
          const req = store.openCursor();
          req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const val = cursor.value;
              const safeTitle = (romTitle || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
              if (!romTitle || val.romTitle === romTitle || val.key.includes(safeTitle) || val.key.includes(romTitle)) {
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
          req.onerror = () => resolve();
        } catch (e) {
          resolve();
        }
      });
    }

    // 2. Include cheats
    try {
      const cheatKey = 'myboy_cheats_' + (romTitle || 'default');
      backup.cheats = localStorage.getItem(cheatKey);
    } catch (e) {}

    return backup;
  }

  async importBackup(backupData) {
    await this._initPromise;
    const data = typeof backupData === 'string' ? JSON.parse(backupData) : backupData;
    if (!data) return { count: 0, batterySave: null };

    let importedCount = 0;
    if (Array.isArray(data.states)) {
      for (const item of data.states) {
        if (item.stateBase64) {
          const u8 = this._base64ToUint8(item.stateBase64);
          await this.saveState(item.romTitle || data.romTitle, item.slot, u8, item.screenshot);
          importedCount++;
        }
      }
    }

    if (data.cheats && (data.romTitle || data.romTitle)) {
      try {
        const key = 'myboy_cheats_' + (data.romTitle || 'default');
        localStorage.setItem(key, typeof data.cheats === 'string' ? data.cheats : JSON.stringify(data.cheats));
      } catch (e) {}
    }

    let batterySave = null;
    if (data.batterySaveBase64) {
      try {
        batterySave = this._base64ToUint8(data.batterySaveBase64);
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

  _base64ToUint8(b64) {
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
