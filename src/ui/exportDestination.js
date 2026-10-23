/**
 * exportDestination.js - Where a finished export lands.
 *
 * By default that is wherever the browser puts downloads. The export panel lets
 * the artist pick a folder instead, and how that works depends on where the
 * editor runs:
 *
 *   - Desktop: a native folder dialog, remembered by the Rust side across
 *     launches. The webview only ever hands over a file name; the folder it
 *     writes into is the one the artist picked (write_export_file in lib.rs).
 *   - Chromium browsers: showDirectoryPicker. The handle is kept for this
 *     session only - a browser will not hand back a path to remember, and a
 *     stored handle needs a fresh permission prompt anyway.
 *   - Anywhere else: downloads, with no choice to offer.
 *
 * A write into the chosen folder that fails falls back to a download, so a
 * render that took two minutes is never lost to a folder that went away.
 */

import { isTauri } from '../utils/isTauri.js';

const listeners = new Set();

/** { kind: 'downloads' } or { kind: 'folder', label, path?, handle? } */
let destination = { kind: 'downloads' };
let loaded = false;

async function invoke(command, args, options) {
  const core = await import('@tauri-apps/api/core');
  return options ? core.invoke(command, args, options) : core.invoke(command, args);
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener(getExportDestination());
    } catch (err) {
      console.warn('[exportDestination] listener failed:', err);
    }
  });
}

function setDestination(next) {
  destination = next;
  notify();
}

/** The last segment of a path, for showing a folder without its whole path. */
function folderName(path) {
  return String(path).split(/[\\/]/).filter(Boolean).pop() || String(path);
}

/** Whether a folder other than downloads can be picked here. */
export function canChooseExportFolder() {
  return isTauri() || (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function');
}

export function getExportDestination() {
  return { ...destination };
}

/** Subscribe to destination changes. Returns an unsubscribe function. */
export function subscribeExportDestination(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Pick up the folder chosen in an earlier session (desktop only). Safe to call
 * more than once; only the first call asks.
 */
export async function loadExportDestination() {
  if (loaded || !isTauri()) return getExportDestination();
  loaded = true;
  try {
    const path = await invoke('get_export_folder');
    if (path) setDestination({ kind: 'folder', label: folderName(path), path });
  } catch {
    // An older desktop binary has no export folder; downloads it is.
  }
  return getExportDestination();
}

/**
 * Ask the artist for a folder. Resolves to the new destination, or the current
 * one when they cancel.
 */
export async function chooseExportFolder() {
  if (isTauri()) {
    const path = await invoke('pick_export_folder');
    if (path) setDestination({ kind: 'folder', label: folderName(path), path });
    return getExportDestination();
  }

  if (typeof window.showDirectoryPicker !== 'function') return getExportDestination();
  try {
    const handle = await window.showDirectoryPicker({ id: 'rhizo-export', mode: 'readwrite' });
    setDestination({ kind: 'folder', label: handle.name, handle });
  } catch (err) {
    // AbortError is a cancel; anything else is worth a line in the console.
    if (err?.name !== 'AbortError') console.warn('[exportDestination] folder picker failed:', err);
  }
  return getExportDestination();
}

/** Go back to the download folder. */
export async function resetExportDestination() {
  if (isTauri()) {
    try {
      await invoke('clear_export_folder');
    } catch {
      // Nothing stored to clear.
    }
  }
  setDestination({ kind: 'downloads' });
}

/**
 * Make sure a browser folder can still be written to. Must run inside the
 * click that starts the export: requestPermission needs the user's gesture,
 * and a recording outlives it.
 */
export async function ensureExportPermission() {
  const { handle } = destination;
  if (!handle || typeof handle.queryPermission !== 'function') return true;
  try {
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

function download(blob, filename, revokeAfterMs) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), revokeAfterMs);
  return link.download;
}

/** A name not yet taken in a browser folder: "a.mp4", then "a (2).mp4". */
async function freeName(handle, filename) {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  for (let attempt = 1; attempt < 1000; attempt++) {
    const name = attempt === 1 ? filename : `${stem} (${attempt})${extension}`;
    try {
      await handle.getFileHandle(name);
    } catch (err) {
      if (err?.name === 'NotFoundError') return name;
      throw err;
    }
  }
  throw new Error(`Too many files named like ${filename}`);
}

/**
 * Save an export to the chosen destination.
 *
 * @returns {Promise<{filename: string, location: string, fellBack?: boolean}>}
 *   `location` is the path or folder written into, or 'Downloads';
 *   `fellBack` is set when a chosen folder could not be written and the file
 *   was downloaded instead.
 */
export async function saveExport(blob, filename, { revokeAfterMs = 100 } = {}) {
  if (destination.kind === 'folder') {
    try {
      if (isTauri()) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const path = await invoke('write_export_file', bytes, {
          headers: { 'x-name': encodeURIComponent(filename) },
        });
        return { filename: folderName(path), location: path };
      }

      const { handle } = destination;
      const name = await freeName(handle, filename);
      const fileHandle = await handle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { filename: name, location: `${handle.name}/${name}` };
    } catch (err) {
      console.warn('[exportDestination] could not write to the chosen folder:', err);
      if (String(err?.message ?? err) === 'no-folder') setDestination({ kind: 'downloads' });
      return { filename: download(blob, filename, revokeAfterMs), location: 'Downloads', fellBack: true };
    }
  }

  return { filename: download(blob, filename, revokeAfterMs), location: 'Downloads' };
}
