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
}

export const saveStateManager = new SaveStateManager();
