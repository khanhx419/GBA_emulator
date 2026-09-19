/**
 * BatterySaveHelper — Direct IndexedDB bridge for GBA .SAV / .SRM files.
 * 
 * Interacts directly with Emscripten IDBFS database ('/data/saves', version 21)
 * to ensure that imported and in-game saves are permanently stored in browser IndexedDB
 * across reboots, app updates, and browser reloads.
 */

const IDBFS_DB_NAME = '/data/saves';
const IDBFS_STORE_NAME = 'FILE_DATA';
const IDBFS_DB_VERSION = 21;

/**
 * Persist raw .SAV / .SRM buffer directly into Emscripten IDBFS database.
 */
export async function writeSavToIndexedDB(romTitle, romFileName, u8Data, extraPaths = []) {
  if (!window.indexedDB) return false;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDBFS_DB_NAME, IDBFS_DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        let store;
        if (db.objectStoreNames.contains(IDBFS_STORE_NAME)) {
          store = e.target.transaction.objectStore(IDBFS_STORE_NAME);
        } else {
          store = db.createObjectStore(IDBFS_STORE_NAME);
        }
        if (!store.indexNames.contains('timestamp')) {
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      req.onsuccess = (e) => {
        const db = e.target.result;
        try {
          const tx = db.transaction(IDBFS_STORE_NAME, 'readwrite');
          const store = tx.objectStore(IDBFS_STORE_NAME);

          const entry = {
            timestamp: new Date(),
            mode: 33206, // Regular file mode
            contents: u8Data instanceof Uint8Array ? u8Data : new Uint8Array(u8Data)
          };

          const safeTitle = (romTitle || 'game').trim();
          const baseName = (romFileName || safeTitle).replace(/\.[^/.]+$/, '').trim();

          const paths = new Set([
            `/data/saves/${safeTitle}.srm`,
            `/data/saves/${safeTitle}.sav`,
            `/data/saves/${baseName}.srm`,
            `/data/saves/${baseName}.sav`,
            `/data/saves/game.srm`,
            `/data/saves/game.sav`,
            ...(Array.isArray(extraPaths) ? extraPaths.filter(Boolean) : [])
          ]);

          paths.forEach(p => {
            try {
              store.put(entry, p);
            } catch (err) {}
          });

          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => {
            db.close();
            resolve(false);
          };
        } catch (txErr) {
          db.close();
          resolve(false);
        }
      };

      req.onerror = () => resolve(false);
    } catch (e) {
      console.warn('[BatterySave] writeSavToIndexedDB error:', e);
      resolve(false);
    }
  });
}

/**
 * Retrieve raw .SAV / .SRM buffer directly from Emscripten IDBFS database.
 */
export async function readSavFromIndexedDB(romTitle, romFileName, extraPaths = []) {
  if (!window.indexedDB) return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDBFS_DB_NAME, IDBFS_DB_VERSION);
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDBFS_STORE_NAME)) {
          db.close();
          return resolve(null);
        }
        try {
          const tx = db.transaction(IDBFS_STORE_NAME, 'readonly');
          const store = tx.objectStore(IDBFS_STORE_NAME);

          const safeTitle = (romTitle || 'game').trim();
          const baseName = (romFileName || safeTitle).replace(/\.[^/.]+$/, '').trim();

          const candidateKeys = [
            ...(Array.isArray(extraPaths) ? extraPaths.filter(Boolean) : []),
            `/data/saves/${safeTitle}.srm`,
            `/data/saves/${baseName}.srm`,
            `/data/saves/${safeTitle}.sav`,
            `/data/saves/${baseName}.sav`,
            `/data/saves/game.srm`,
            `/data/saves/game.sav`
          ];

          let found = null;
          let idx = 0;

          const checkNext = () => {
            if (idx >= candidateKeys.length || found) {
              db.close();
              return resolve(found);
            }
            const k = candidateKeys[idx++];
            const getReq = store.get(k);
            getReq.onsuccess = () => {
              if (getReq.result && getReq.result.contents && getReq.result.contents.length > 0) {
                found = getReq.result.contents;
                db.close();
                resolve(found);
              } else {
                checkNext();
              }
            };
            getReq.onerror = () => checkNext();
          };

          checkNext();
        } catch (err) {
          db.close();
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}
