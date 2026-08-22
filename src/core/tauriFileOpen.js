// Desktop `.rz` file association: open a patch that was double-clicked in the
// OS file browser (or passed on the command line).
//
// Two arrival paths, mirroring the Rust side in src-tauri/src/lib.rs:
//
//   - Cold launch: the path is stashed before the window exists, so the editor
//     drains it with take_pending_open() once it has booted.
//   - Already running (macOS): the OS emits an open event, which arrives here
//     as 'rhizomium://open-file'.
//
// Both funnel into the same loader. take_pending_open() clears the slot, so a
// cold macOS launch — which stashes *and* emits — still opens the file once.
//
// Everything is behind isTauri() and dynamic import(), because '@tauri-apps/api'
// is a bare specifier the un-bundled web deployments cannot resolve.

import { isTauri } from '../utils/isTauri.js';
import { modalManager } from '../ui/ModalManager.js';

const OPEN_FILE_EVENT = 'rhizomium://open-file';

/** Turn an OS path into the File the normal open path already knows how to load. */
function toFile(path, contents) {
  const name = path.split(/[\\/]/).pop() || 'patch.rz';
  return new File([contents], name, { type: 'application/json' });
}

/**
 * Wire up the desktop file association.
 *
 * @param {(file: File) => Promise<void>} loadProjectFromFile
 *   The editor's normal "open this project file" path.
 * @returns {Promise<() => void>} unlisten function (a no-op outside Tauri).
 */
export async function setupTauriFileAssociation(loadProjectFromFile) {
  const noop = () => {};
  if (!isTauri() || typeof loadProjectFromFile !== 'function') return noop;

  let invoke;
  let listen;
  try {
    [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);
  } catch (err) {
    console.warn('Tauri file association unavailable:', err);
    return noop;
  }

  const openPath = async (path) => {
    if (!path) return;
    try {
      const contents = await invoke('read_project_file', { path });
      await loadProjectFromFile(toFile(path, contents));
    } catch (err) {
      console.error(`Could not open ${path}:`, err);
      try {
        await modalManager.alert(
          `Could not open this patch:\n\n${err?.message || err}`,
          'Open Failed',
        );
      } catch {
        /* modal unavailable - the console error stands on its own */
      }
    }
  };

  let unlisten = noop;
  try {
    unlisten = await listen(OPEN_FILE_EVENT, (event) => openPath(event?.payload));
  } catch (err) {
    console.warn('Could not listen for file-association opens:', err);
  }

  // Drain the launch argument last, so the listener is already in place if the
  // OS emits an event for the same launch.
  try {
    await openPath(await invoke('take_pending_open'));
  } catch (err) {
    console.warn('Could not read the pending file to open:', err);
  }

  return unlisten;
}
