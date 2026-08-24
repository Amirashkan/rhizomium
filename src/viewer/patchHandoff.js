/**
 * patchHandoff.js — passing the patch open in the editor to the viewer tab.
 *
 * File → Open in Web Viewer opens a second tab at `/viewer?handoff=<id>`. The
 * patch itself goes through IndexedDB rather than the URL or the gallery:
 *
 *   - It is far too big for a query string once textures are inlined, and too
 *     big for localStorage for the same reason.
 *   - Routing it through the gallery would mean publishing to look at your own
 *     work, which is a different act with a different audience.
 *   - postMessage from the opener would die on a reload of the viewer tab, and
 *     the first thing anyone does to a stuck page is reload it.
 *
 * Records are handed over, not owned: the viewer reads one and it stays put so
 * a reload still works, and each new handoff prunes the stale ones.
 */

import { runTransaction, VIEWER_HANDOFF_STORE } from '../core/rhizomiumDB.js';

/** How long a handed-over patch stays readable before it is pruned. */
export const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

function newHandoffId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Store a patch for the viewer to pick up.
 *
 * @param {object} patchData the serialized patch (serializePatchData output)
 * @param {{title?: string|null}} [meta]
 * @returns {Promise<string>} the id to put in the viewer's URL
 */
export async function putHandoff(patchData, meta = {}) {
  const id = newHandoffId();
  const record = {
    id,
    savedAt: Date.now(),
    title: meta.title || null,
    patch: patchData,
  };

  await runTransaction(VIEWER_HANDOFF_STORE, 'readwrite', (store) => {
    store.put(record);

    // Prune anything older than the TTL on the way past, so a browser profile
    // does not accumulate every patch its owner ever previewed.
    const cutoff = Date.now() - HANDOFF_TTL_MS;
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const value = cursor.value;
      if (value?.id !== id && (!value?.savedAt || value.savedAt < cutoff)) {
        cursor.delete();
      }
      cursor.continue();
    };
  });

  return id;
}

/**
 * Read a handed-over patch.
 *
 * @returns {Promise<{id: string, title: string|null, patch: object}|null>}
 *   null when there is no such record, or it has aged out.
 */
export async function takeHandoff(id) {
  const record = await runTransaction(VIEWER_HANDOFF_STORE, 'readonly', (store) =>
    store.get(String(id)),
  );

  if (!record?.patch) return null;
  if (record.savedAt && Date.now() - record.savedAt > HANDOFF_TTL_MS) return null;

  return record;
}
