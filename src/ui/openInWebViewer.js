/**
 * openInWebViewer.js — File → Open in Web Viewer.
 *
 * Hands the patch open in the editor to the web viewer in a second tab, so an
 * artist can see their work the way a visitor to the gallery will: full-bleed,
 * no editor around it, running from the published document rather than from
 * live editor state.
 *
 * Two things make this more than a `window.open()`:
 *
 *   1. **The tab is opened inside the click.** Every browser blocks a popup
 *      opened from an async continuation, and serializing a patch with textures
 *      in it is not instant. So a blank tab is opened synchronously first and
 *      pointed at the viewer once the patch is stored — the same trick the
 *      second-monitor popup uses.
 *   2. **The patch never leaves the machine.** It goes through IndexedDB (see
 *      viewer/patchHandoff.js), not through the gallery: looking at your own
 *      work should not mean publishing it first.
 *
 * The gate is the viewer's own — `viewer.web`, a Cloude entitlement. Checking
 * it here as well is a courtesy, not a second lock: it turns "a tab opens and
 * tells you no" into "the editor tells you no, and no tab opens".
 */

import { serializePatchData, checkPatchSize, stableStringify } from '../core/patchSerializer.js';
import { putHandoff } from '../viewer/patchHandoff.js';
import { resolveWebViewerAccess, refusalMessage } from '../viewer/viewerGate.js';
import { APP_VERSION } from '../utils/appVersion.js';
import { modalManager } from './ModalManager.js';

/** Where the viewer lives, relative to whatever is serving the editor. */
export function viewerUrl(handoffId, title, origin = window.location.origin) {
  const url = new URL('/viewer', origin);
  url.searchParams.set('handoff', handoffId);
  if (title) url.searchParams.set('title', title);
  return url.toString();
}

/**
 * @param {{onStatus?: (message: string, type?: string) => void}} [options]
 */
export async function openInWebViewer(options = {}) {
  const status = options.onStatus || (() => {});

  const manager = window.saveLoadManager;
  if (!manager || typeof manager.exportProject !== 'function') {
    status('The project could not be read.', 'error');
    return;
  }

  // Opened now, navigated later: see the note above.
  const tab = window.open('', '_blank');

  const fail = async (message, { alert = false, title = 'Web Viewer' } = {}) => {
    tab?.close();
    status(message, 'warning');
    if (alert) await modalManager.alert(message, title);
  };

  try {
    const check = await resolveWebViewerAccess();
    if (!check.allowed) {
      await fail(`${refusalMessage(check)} See ${check.upgradeUrl}`, { alert: true });
      return;
    }

    const projectData = manager.exportProject();
    if (!projectData?.nodes?.length) {
      await fail('There is nothing on the canvas to view yet.');
      return;
    }

    const projectTitle = manager.getProjectName?.() || '';
    const patchData = serializePatchData(projectData, {
      title: projectTitle,
      generatorVersion: APP_VERSION,
    });

    // The viewer reads a patch, so hold it to the same size limit the gallery
    // sets for one — a patch too big to publish is one this is the wrong
    // preview of.
    const oversize = checkPatchSize(new Blob([stableStringify(patchData)]));
    if (oversize) {
      await fail(oversize, { alert: true, title: 'Patch Too Large' });
      return;
    }

    const handoffId = await putHandoff(patchData, { title: projectTitle });
    const url = viewerUrl(handoffId, projectTitle);

    if (tab) tab.location = url;
    else window.open(url, '_blank'); // popup blocked; try once more, plainly

    status('Opened in the web viewer.');
  } catch (error) {
    console.error('[openInWebViewer]', error);
    await fail(`Could not open the web viewer: ${error.message}`, { alert: true });
  }
}
