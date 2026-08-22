// Storage for the autosave snapshot.
//
// The autosave used to be a single localStorage key holding the whole project
// as JSON. Once a patch inlines a texture - let alone a video - that payload
// passes the ~5MB quota and every setItem throws QuotaExceededError, so
// autosave silently stopped working exactly on the projects that most needed
// it. The snapshot now goes:
//
//   - on desktop (Tauri): to a real file in the app data directory, which is
//     the only place a video patch comfortably fits;
//   - in a browser: to IndexedDB, which has no practical size limit.
//
// Either way localStorage keeps only a tiny pointer record (timestamp and node
// counts) so the startup recovery checks can stay synchronous.

import { AUTOSAVE_STORE, openRhizomiumDB, runTransaction } from "./rhizomiumDB.js";
import { isTauri } from "../utils/isTauri.js";

const RECORD_ID = "current";

/**
 * Normalizes the localStorage autosave entry into { timestamp, nodeCount, data }.
 * Handles both the current pointer record (metadata only, snapshot stored
 * elsewhere) and the legacy record that inlined the whole project.
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

export class IndexedDBAutosaveStore {
  /**
   * Stores the snapshot, replacing any previous one.
   *
   * The record is stored as one JSON string, the same way the desktop store
   * writes its file. The old shape round-tripped through JSON *and then* handed
   * the rebuilt object graph to structured clone - three full copies of a
   * patch's inlined media per autosave, ~60ms of blocked main thread on a
   * 4MB texture. Stringify is the scrub the round-trip was there for, so
   * keeping the string is both cheaper and the same guarantee.
   */
  async put(record) {
    const json = JSON.stringify(record);
    await runTransaction(AUTOSAVE_STORE, "readwrite", (store) =>
      store.put({ id: RECORD_ID, json }),
    );
  }

  /** Returns the stored snapshot, or null when there is none. */
  async get() {
    const db = await openRhizomiumDB();
    const stored = await new Promise((resolve, reject) => {
      const request = db
        .transaction(AUTOSAVE_STORE, "readonly")
        .objectStore(AUTOSAVE_STORE)
        .get(RECORD_ID);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });

    if (!stored) return null;
    // A snapshot written by an older build is still the plain object.
    if (typeof stored.json !== "string") return stored;
    try {
      return JSON.parse(stored.json);
    } catch {
      return null;
    }
  }

  async clear() {
    await runTransaction(AUTOSAVE_STORE, "readwrite", (store) => store.clear());
  }
}

/**
 * Desktop autosave: one file in the app data directory, written through the
 * Rust side (src-tauri/src/lib.rs). No browser storage is involved, so patch
 * size stops being a question - a patch with an inlined video is just a big
 * file, which is what it always was on disk.
 *
 * '@tauri-apps/api' is imported dynamically because it is a bare specifier the
 * un-bundled web deployments cannot resolve; the same pattern as
 * core/tauriFileOpen.js.
 */
export class TauriAutosaveStore {
  async _invoke(command, args) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args);
  }

  async put(record) {
    await this._invoke("write_autosave", { contents: JSON.stringify(record) });
  }

  async get() {
    const contents = await this._invoke("read_autosave");
    if (!contents) return null;
    return JSON.parse(contents);
  }

  async clear() {
    await this._invoke("clear_autosave");
  }
}

/**
 * Desktop store that falls back to IndexedDB if the Rust side does not answer -
 * an older binary running a newer frontend has no write_autosave command, and
 * losing autosave entirely over that would be worse than a browser-storage
 * snapshot.
 */
export class FallbackAutosaveStore {
  constructor(primary, fallback) {
    this.primary = primary;
    this.fallback = fallback;
    this._usingFallback = false;
  }

  async _run(method, ...args) {
    if (!this._usingFallback) {
      try {
        return await this.primary[method](...args);
      } catch (error) {
        this._usingFallback = true;
        window.errorHandler?.handleError(error, {
          component: "autosave-desktop-store",
          method,
        });
      }
    }
    return this.fallback[method](...args);
  }

  put(record) {
    return this._run("put", record);
  }

  get() {
    return this._run("get");
  }

  clear() {
    return this._run("clear");
  }
}

/** Picks the snapshot store for the environment the editor is running in. */
export function createAutosaveStore() {
  const indexedDbStore = new IndexedDBAutosaveStore();
  if (!isTauri()) return indexedDbStore;
  return new FallbackAutosaveStore(new TauriAutosaveStore(), indexedDbStore);
}
