// Files dropped on the desktop editor.
//
// Tauri takes file drops for itself (its native drag-drop handler is on by
// default), so the webview's own `drop` events never carry them - and even if
// they did, a webview File has no path, which is what a project now saves its
// media by (mediaRefs.js). So the Rust side grants the dropped paths and
// re-emits them with where they landed (handle_drag_drop in
// src-tauri/src/lib.rs); this reads them in and replays the drop on the element
// under the cursor as an ordinary DOM drop. Every existing drop zone - texture
// and audio inputs, fonts, the VJ audio tab, the canvas opening a .rz - takes
// it with no desktop-specific code of its own, and each File already knows its
// path.
//
// Behind isTauri() and dynamic import(), like tauriFileOpen.js.

import { isTauri } from '../utils/isTauri.js';
import { readMediaAsFile } from './mediaPaths.js';

const MEDIA_DROP_EVENT = 'rhizomium://media-drop';

/**
 * Replay a native drop as a DOM `drop` event at a physical-pixel position.
 *
 * @param {File[]} files
 * @param {number} x physical pixels from the webview's left edge
 * @param {number} y physical pixels from its top edge
 */
export function dispatchFileDrop(files, x, y) {
  const ratio = window.devicePixelRatio || 1;
  const clientX = x / ratio;
  const clientY = y / ratio;
  const target = document.elementFromPoint(clientX, clientY) || document.body;

  const dataTransfer = new DataTransfer();
  for (const file of files) dataTransfer.items.add(file);
  const event = new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    dataTransfer,
  });
  // Chromium honours the init dictionary; a DOM that does not still gets the files.
  if (!event.dataTransfer) Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(event);
  return target;
}

/**
 * Start listening for native file drops. Resolves to an unlisten function
 * (a no-op outside Tauri).
 */
export async function setupTauriMediaDrop() {
  const noop = () => {};
  if (!isTauri()) return noop;

  let listen;
  try {
    ({ listen } = await import('@tauri-apps/api/event'));
  } catch (err) {
    console.warn('Tauri media drop unavailable:', err);
    return noop;
  }

  return listen(MEDIA_DROP_EVENT, async (event) => {
    const [paths, x, y] = Array.isArray(event?.payload) ? event.payload : [];
    if (!Array.isArray(paths) || !paths.length) return;

    const files = [];
    for (const path of paths) {
      try {
        files.push(await readMediaAsFile(path));
      } catch (err) {
        // A dropped folder, or a file that vanished mid-drop: the rest still land.
        console.warn(`Could not read dropped ${path}:`, err);
      }
    }
    if (files.length) dispatchFileDrop(files, Number(x) || 0, Number(y) || 0);
  });
}
