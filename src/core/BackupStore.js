// IndexedDB-backed storage for project backups.
//
// Backups embed full texture dataUrls, so a handful of snapshots can easily
// exceed the ~5MB localStorage quota - which made the old localStorage-based
// backup system silently stop working. IndexedDB has no such practical limit.

import { BACKUPS_STORE, openRhizomiumDB, runTransaction } from "./rhizomiumDB.js";

const STORE_NAME = BACKUPS_STORE;

export class BackupStore {
  async _transaction(mode, fn) {
    return runTransaction(STORE_NAME, mode, fn);
  }

  async add(backup) {
    await this._transaction("readwrite", (store) => store.put(backup));
  }

  async get(id) {
    const db = await openRhizomiumDB();
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
    const db = await openRhizomiumDB();
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
