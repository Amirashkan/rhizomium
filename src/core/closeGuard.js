// src/core/closeGuard.js
//
// "You have edits since your last save" on the way out of the desktop app.
//
// The web build gets this from the browser: beforeunload (SaveLoadManager
// .setupUnloadHandler) asks before the tab goes. A Tauri window closes on an
// OS event that never reaches beforeunload, so the desktop needs its own gate
// - and, having one, can do better than the browser's fixed two-button
// dialog: Save writes the file before the window goes.
//
// '@tauri-apps/api' is reached through dynamic import() because it is a bare
// specifier the un-bundled web deployments cannot resolve; isTauri() keeps
// this a no-op everywhere else.

import { isTauri } from '../utils/isTauri.js';
import { modalManager } from '../ui/ModalManager.js';

/**
 * Ask before a close that would drop unsaved edits.
 *
 * @param {import('./SaveLoadManager.js').SaveLoadManager} saveLoadManager
 * @returns {Promise<Function|null>} an unlisten function, or null when there
 *   is nothing to guard (web build, or the window API is unavailable).
 */
export async function installUnsavedCloseGuard(saveLoadManager) {
  if (!isTauri() || !saveLoadManager) return null;

  let appWindow;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    appWindow = getCurrentWindow();
  } catch (error) {
    window.errorHandler?.handleError(error, { component: 'close-guard-setup' });
    return null;
  }

  // Set once the artist has decided: the close that follows must not be
  // caught and questioned a second time.
  let closing = false;

  try {
    return await appWindow.onCloseRequested(async (event) => {
      if (closing || !saveLoadManager.hasUnsavedWork()) return;

      event.preventDefault();

      const choice = await askBeforeClosing(saveLoadManager);
      if (choice === 'cancel') return;

      if (choice === 'save') {
        // A failed or cancelled save must not take the patch down with it.
        let saved = false;
        try {
          saved = await saveLoadManager.saveProject();
        } catch (error) {
          window.errorHandler?.handleError(error, { component: 'close-guard-save' });
        }
        if (!saved) return;
      }

      closing = true;
      // destroy(), not close(): close() comes back through this same handler.
      try {
        await appWindow.destroy();
      } catch (error) {
        window.errorHandler?.handleError(error, { component: 'close-guard-close' });
      }
    });
  } catch (error) {
    window.errorHandler?.handleError(error, { component: 'close-guard-setup' });
    return null;
  }
}

/**
 * @returns {Promise<'save'|'discard'|'cancel'>} Escape and a click outside
 *   both mean cancel - closing is the destructive answer here, so it is only
 *   ever reached by choosing it.
 */
async function askBeforeClosing(saveLoadManager) {
  const name = saveLoadManager.currentProjectName
    ? `"${saveLoadManager.getProjectName()}"`
    : 'This patch';

  let choice = 'cancel';
  try {
    // custom() resolves when the dialog closes, whichever way it went, so the
    // answer is carried out in a local: Escape resolves it as a cancel.
    await modalManager.custom({
      title: 'Unsaved changes',
      body: `${name} has changes you haven't saved. Save before closing?`,
      requireAction: true,
      buttons: [
        { label: 'Cancel', onClick: () => { choice = 'cancel'; } },
        { label: "Don't Save", danger: true, onClick: () => { choice = 'discard'; } },
        { label: 'Save', primary: true, onClick: () => { choice = 'save'; } },
      ],
    });
  } catch (error) {
    window.errorHandler?.handleError(error, { component: 'close-guard-dialog' });
    return 'cancel';
  }
  return choice;
}
