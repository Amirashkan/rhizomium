// Shared IndexedDB handle for the "rhizomium" database.
//
// Backups and the autosave both live here because their payloads embed full
// texture dataUrls, which blow past the ~5MB localStorage quota. Both stores
// are created from one place so a version bump can never leave the two
// openers disagreeing about DB_VERSION (which would fail with VersionError
// for whichever one opened second).

const DB_NAME = "rhizomium";
const DB_VERSION = 2;

export const BACKUPS_STORE = "backups";
export const AUTOSAVE_STORE = "autosave";

let dbPromise = null;

export function openRhizomiumDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BACKUPS_STORE)) {
        const store = db.createObjectStore(BACKUPS_STORE, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) {
        db.createObjectStore(AUTOSAVE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Failed to open the Rhizomium database"));
    request.onblocked = () =>
      reject(new Error("Rhizomium database is blocked by another tab"));
  });

  // Allow a retry on the next call if opening failed
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

/** Runs fn(store) inside a transaction and resolves once the transaction commits. */
export async function runTransaction(storeName, mode, fn) {
  const db = await openRhizomiumDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () =>
      resolve(result?.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error || new Error(`${storeName} transaction failed`));
    tx.onabort = () => reject(tx.error || new Error(`${storeName} transaction aborted`));
  });
}
