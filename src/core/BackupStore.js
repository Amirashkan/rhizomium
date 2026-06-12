// IndexedDB-backed storage for project backups.
//
// Backups embed full texture dataUrls, so a handful of snapshots can easily
// exceed the ~5MB localStorage quota - which made the old localStorage-based
// backup system silently stop working. IndexedDB has no such practical limit.

const DB_NAME = "rhizomium";
const DB_VERSION = 1;
const STORE_NAME = "backups";

export class BackupStore {
  constructor() {
    this._dbPromise = null;
  }

  _open() {
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this browser"));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("Failed to open backup database"));
      request.onblocked = () =>
        reject(new Error("Backup database is blocked by another tab"));
    });

    // Allow a retry on the next call if opening failed
    this._dbPromise.catch(() => {
      this._dbPromise = null;
    });

    return this._dbPromise;
  }

  async _transaction(mode, fn) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try {
        result = fn(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result?.result !== undefined ? result.result : result);
      tx.onerror = () => reject(tx.error || new Error("Backup transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("Backup transaction aborted"));
    });
  }

  async add(backup) {
    await this._transaction("readwrite", (store) => store.put(backup));
  }

  async get(id) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /** Returns all backups, newest first. */
  async getAll() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .getAll();
      request.onsuccess = () => {
        const backups = request.result || [];
        backups.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(backups);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async delete(id) {
    await this._transaction("readwrite", (store) => store.delete(id));
  }

  async clear() {
    await this._transaction("readwrite", (store) => store.clear());
  }

  /** Deletes the oldest backups so that at most maxCount remain. */
  async prune(maxCount) {
    const backups = await this.getAll();
    if (backups.length <= maxCount) return;

    const excess = backups.slice(maxCount);
    await this._transaction("readwrite", (store) => {
      for (const backup of excess) {
        store.delete(backup.id);
      }
    });
  }
}
