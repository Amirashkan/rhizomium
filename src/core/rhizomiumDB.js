// Shared IndexedDB handle for the "rhizomium" database.
//
// Backups, the autosave and the editor's handoff to the web viewer all live
// here because their payloads embed full texture dataUrls, which blow past the
// ~5MB localStorage quota. Every store is created from one place so a version
// bump can never leave two openers disagreeing about DB_VERSION (which would
// fail with VersionError for whichever one opened second).

const DB_NAME = "rhizomium";
const DB_VERSION = 3;

export const BACKUPS_STORE = "backups";
export const AUTOSAVE_STORE = "autosave";
// Patches the editor hands to the web viewer in another tab. Same database
// for the same reason: a patch carries its textures inline and does not fit
// in localStorage.
export const VIEWER_HANDOFF_STORE = "viewerHandoff";

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
      if (!db.objectStoreNames.contains(VIEWER_HANDOFF_STORE)) {
        db.createObjectStore(VIEWER_HANDOFF_STORE, { keyPath: "id" });
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
