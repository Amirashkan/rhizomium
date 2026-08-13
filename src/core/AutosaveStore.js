// IndexedDB-backed storage for the autosave snapshot.
//
// The autosave used to be a single localStorage key holding the whole project
// as JSON. Once a patch inlines a texture or two that payload passes the ~5MB
// quota and every setItem throws QuotaExceededError - so autosave silently
// stopped working exactly on the projects that most needed it. The snapshot
// now lives in IndexedDB (no practical size limit); localStorage keeps only a
// tiny pointer record so the startup checks can stay synchronous.

import { AUTOSAVE_STORE, openRhizomiumDB, runTransaction } from "./rhizomiumDB.js";

const RECORD_ID = "current";

/**
 * Normalizes the localStorage autosave entry into { timestamp, nodeCount, data }.
 * Handles both the current pointer record (metadata only, snapshot in IndexedDB)
 * and the legacy record that inlined the whole project.
 */
export function parseAutosaveEntry(stored) {
  if (!stored) return null;

  let entry = stored;
  if (typeof stored === "string") {
    try {
      entry = JSON.parse(stored);
    } catch {
      return null;
    }
  }
  if (!entry || typeof entry !== "object") return null;

  const data = entry.data && typeof entry.data === "object" ? entry.data : null;
  const nodeCount =
    typeof entry.nodeCount === "number"
      ? entry.nodeCount
      : Array.isArray(data?.nodes)
        ? data.nodes.length
        : 0;

  return {
    timestamp: typeof entry.timestamp === "number" ? entry.timestamp : null,
    version: entry.version,
    nodeCount,
    data,
  };
}

export class AutosaveStore {
  /** Stores the snapshot, replacing any previous one. */
  async put(record) {
    await runTransaction(AUTOSAVE_STORE, "readwrite", (store) =>
      store.put({ ...record, id: RECORD_ID }),
    );
  }

  /** Returns the stored snapshot, or null when there is none. */
  async get() {
    const db = await openRhizomiumDB();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(AUTOSAVE_STORE, "readonly")
        .objectStore(AUTOSAVE_STORE)
        .get(RECORD_ID);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async clear() {
    await runTransaction(AUTOSAVE_STORE, "readwrite", (store) => store.clear());
  }
}
