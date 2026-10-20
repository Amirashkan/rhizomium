/**
 * AudioLibrary.js
 *
 * The VJ panel's audio files: a list of tracks the artist keeps on hand so a
 * bed can be swapped mid-set by picking it from the panel, rather than going
 * back to the Audio panel's file dialog every time.
 *
 * The tracks themselves are kept, not just their names — a browser cannot
 * reopen a file by path — so each one is a Blob in IndexedDB (VJ_AUDIO_STORE),
 * one record per track, with the running order in a record of its own. Where
 * IndexedDB is missing the library still works, for the session only, and says
 * so through `persistent`.
 *
 * On the desktop a track picked or dropped from disk also keeps its `path`, so
 * a project file can name the track by path instead of carrying its bytes
 * (core/mediaRefs.js).
 *
 * It does not play anything. Handing a track to the audio system is the
 * panel's job, through the same audio deck the performer uses
 * (src/audio/audioDeck.js), so what the meters read is always one element.
 */

import { runTransaction, VJ_AUDIO_STORE } from '../core/rhizomiumDB.js';
import { dataUrlToBlob } from '../core/dataUrl.js';
import { basename, mimeForName, pathFor, rememberPath } from '../core/mediaPaths.js';

const ORDER_RECORD_ID = '__order';

const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|webm|aif|aiff)$/i;

/** Whether a dropped or picked file is something an audio element can try to play. */
export function isAudioFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type.startsWith('audio/')) return true;
  return AUDIO_EXTENSIONS.test(String(file.name || ''));
}

/** The record store over the shared Rhizomium database. */
export function indexedDBAudioStore() {
  return {
    getAll: () => runTransaction(VJ_AUDIO_STORE, 'readonly', (store) => store.getAll()),
    put: (record) => runTransaction(VJ_AUDIO_STORE, 'readwrite', (store) => store.put(record)),
    delete: (id) => runTransaction(VJ_AUDIO_STORE, 'readwrite', (store) => store.delete(id)),
  };
}

let counter = 0;
function newId() {
  counter += 1;
  return `audio_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 7)}`;
}

/** What callers see of a track: everything but the bytes. */
const describe = (record) => ({
  id: record.id,
  name: record.name,
  type: record.type || '',
  size: record.size || 0,
  addedAt: record.addedAt || 0,
});

export class AudioLibrary {
  /**
   * @param {object} [store] `{ getAll, put, delete }`, injected by the tests.
   *   Left out, it is the IndexedDB store.
   */
  constructor(store = null) {
    this.store = store || indexedDBAudioStore();
    this.tracks = new Map(); // id -> record, blob included
    this.order = [];
    this.persistent = true;
    this.onChange = null;
    // Writes queue behind the load and each other so a slow write cannot land
    // a stale order over a newer one.
    this._chain = Promise.resolve();
  }

  _enqueue(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async _write(fn) {
    if (!this.persistent) return false;
    try {
      await fn();
      return true;
    } catch {
      // Quota or a blocked database: keep what is in memory, and stop
      // pretending the library will be there after a reload.
      this.persistent = false;
      return false;
    }
  }

  _writeOrder() {
    return this._write(() => this.store.put({ id: ORDER_RECORD_ID, ids: [...this.order] }));
  }

  _changed() {
    try { this.onChange?.(); } catch { /* a listener's problem is not the library's */ }
  }

  /** Read the saved library. Tracks added while the read was in flight are kept after it. */
  load() {
    return this._enqueue(async () => {
      let records;
      try {
        records = await this.store.getAll();
      } catch {
        this.persistent = false;
        return false;
      }
      if (!Array.isArray(records)) return false;

      const orderRecord = records.find((r) => r?.id === ORDER_RECORD_ID);
      const stored = new Map();
      for (const record of records) {
        if (!record || record.id === ORDER_RECORD_ID || !record.blob) continue;
        stored.set(record.id, record);
      }

      // The order record says how they were arranged; a track it does not
      // mention (a write that landed without its order) goes on the end,
      // oldest first, rather than vanishing.
      const ordered = (Array.isArray(orderRecord?.ids) ? orderRecord.ids : []).filter((id) => stored.has(id));
      const rest = [...stored.keys()]
        .filter((id) => !ordered.includes(id))
        .sort((a, b) => (stored.get(a).addedAt || 0) - (stored.get(b).addedAt || 0));

      const pending = this.order.filter((id) => !stored.has(id));
      const pendingRecords = pending.map((id) => this.tracks.get(id));

      this.tracks = new Map(stored);
      pendingRecords.forEach((record) => this.tracks.set(record.id, record));
      this.order = [...ordered, ...rest, ...pending];

      this._changed();
      return true;
    });
  }

  /** The tracks in running order, without their bytes. */
  getAll() {
    return this.order.map((id) => describe(this.tracks.get(id)));
  }

  get(id) {
    const record = this.tracks.get(id);
    return record ? describe(record) : null;
  }

  get size() {
    return this.order.length;
  }

  /**
   * The track as a File the audio system can load. Named after the track, so
   * a renamed track shows its new name wherever the audio system names it.
   */
  fileFor(id) {
    const record = this.tracks.get(id);
    if (!record) return null;
    const type = record.type || record.blob.type || '';
    if (typeof File === 'function') {
      return new File([record.blob], record.name, { type });
    }
    // Environments without File: a Blob with a name is all loadFile() reads.
    const blob = record.blob;
    try { Object.defineProperty(blob, 'name', { value: record.name, configurable: true }); } catch { /* frozen */ }
    return blob;
  }

  /**
   * Add files to the end of the library. Anything that is not audio is
   * skipped and reported, so a folder dropped whole does not fill the list
   * with cover art.
   *
   * @returns {Promise<{added: object[], skipped: string[]}>}
   */
  add(files) {
    const list = Array.from(files || []);
    const added = [];
    const skipped = [];
    const now = Date.now();

    list.forEach((file, i) => {
      if (!isAudioFile(file)) {
        skipped.push(String(file?.name || 'unnamed file'));
        return;
      }
      const record = {
        id: newId(),
        name: String(file.name || `Track ${this.order.length + 1}`),
        type: file.type || '',
        size: file.size || 0,
        addedAt: now + i,
        blob: file,
      };
      const path = pathFor(file);
      if (path) record.path = path;
      this.tracks.set(record.id, record);
      this.order.push(record.id);
      added.push(record);
    });

    if (added.length) this._changed();

    return this._enqueue(async () => {
      for (const record of added) {
        await this._write(() => this.store.put(record));
      }
      if (added.length) await this._writeOrder();
      return { added: added.map(describe), skipped };
    });
  }

  rename(id, name) {
    const record = this.tracks.get(id);
    const trimmed = String(name ?? '').trim();
    if (!record || !trimmed || trimmed === record.name) return Promise.resolve(false);
    record.name = trimmed;
    this._changed();
    return this._enqueue(() => this._write(() => this.store.put(record)).then(() => true));
  }

  remove(id) {
    if (!this.tracks.has(id)) return Promise.resolve(false);
    this.tracks.delete(id);
    this.order = this.order.filter((other) => other !== id);
    this._changed();
    return this._enqueue(async () => {
      await this._write(() => this.store.delete(id));
      await this._writeOrder();
      return true;
    });
  }

  move(id, toIndex) {
    const from = this.order.indexOf(id);
    if (from < 0) return Promise.resolve(false);
    const to = Math.max(0, Math.min(this.order.length - 1, Math.floor(Number(toIndex) || 0)));
    if (to === from) return Promise.resolve(false);
    this.order.splice(from, 1);
    this.order.splice(to, 0, id);
    this._changed();
    return this._enqueue(() => this._writeOrder().then(() => true));
  }

  /**
   * The tracks in running order, bytes inlined, as a project file carries
   * them. A track that cannot be read is left out rather than failing the save.
   *
   * With `byPath`, a track that came from a file on disk is named by its path
   * instead (`{ name, type, ref }`) and its bytes are not read at all.
   *
   * @param {{byPath?: boolean}} [options]
   * @returns {Promise<{name: string, type: string, data?: string, ref?: object}[]>}
   */
  async exportTracks({ byPath = false } = {}) {
    const out = [];
    for (const id of [...this.order]) {
      const record = this.tracks.get(id);
      if (!record?.blob) continue;
      if (byPath && record.path) {
        const name = basename(record.path);
        out.push({
          name: record.name,
          type: record.type || record.blob.type || '',
          ref: { path: record.path, name, mime: mimeForName(name) },
        });
        continue;
      }
      try {
        out.push({ name: record.name, type: record.type || record.blob.type || '', data: await blobToDataUrl(record.blob, record.type) });
      } catch {
        // Unreadable bytes: the rest of the list still saves.
      }
    }
    return out;
  }

  /**
   * Replace the library with tracks from a project file. Entries that do not
   * decode are skipped. An entry may carry its bytes as a `file` rather than
   * `data` - a track the desktop editor read back from its path.
   */
  async importTracks(entries) {
    const files = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (typeof Blob === 'function' && entry?.file instanceof Blob) {
        const name = String(entry.name || `Track ${files.length + 1}`);
        const type = entry.type || entry.file.type || '';
        const file = typeof File === 'function'
          ? new File([entry.file], name, { type })
          : Object.assign(entry.file, { name });
        // Named after the track rather than the file on disk, so it is a new
        // File: carry the path over to it.
        rememberPath(file, pathFor(entry.file) || entry.ref?.path);
        files.push(file);
        continue;
      }
      if (typeof entry?.data !== 'string') continue;
      try {
        const blob = dataUrlToBlob(entry.data);
        const type = entry.type || blob.type || '';
        const name = String(entry.name || `Track ${files.length + 1}`);
        files.push(typeof File === 'function'
          ? new File([blob], name, { type })
          : Object.assign(blob, { name }));
      } catch {
        // A damaged entry costs only itself.
      }
    }
    this.clear();
    const { added } = await this.add(files);
    return added;
  }

  clear() {
    const ids = [...this.order];
    if (!ids.length) return Promise.resolve(false);
    this.tracks.clear();
    this.order = [];
    this._changed();
    return this._enqueue(async () => {
      for (const id of ids) await this._write(() => this.store.delete(id));
      await this._writeOrder();
      return true;
    });
  }
}

/** A Blob as a base64 data: URL, for the project file. */
function blobToDataUrl(blob, type) {
  const source = type && !blob.type ? new Blob([blob], { type }) : blob;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read the track.'));
    reader.readAsDataURL(source);
  });
}

/** "3.4 MB", for the row under a track's name. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
