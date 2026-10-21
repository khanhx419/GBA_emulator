export async function deleteBatteryFiles(paths) {
  if (!globalThis.indexedDB) return true;
  return new Promise(resolve => {
    try {
      const request = indexedDB.open('/data/saves', 21);
      request.onerror = request.onblocked = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('FILE_DATA')) { db.close(); resolve(true); return; }
        try {
          const transaction = db.transaction('FILE_DATA', 'readwrite');
          transaction.oncomplete = () => { db.close(); resolve(true); };
          transaction.onabort = transaction.onerror = () => { db.close(); resolve(false); };
          const store = transaction.objectStore('FILE_DATA');
          for (const path of paths) store.delete(path);
        } catch (error) { db.close(); resolve(false); }
      };
    } catch (error) { resolve(false); }
  });
}
