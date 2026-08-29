// src/ui/viewerLink.js
//
// THE LINK: turning the patch open in the editor into a URL someone can be sent.
//
// There are two of them, and conflating them is the mistake this module exists
// to prevent.
//
//   PREVIEW   /viewer?handoff=<id>
//             The patch goes through this browser's IndexedDB. Instant, private,
//             and worth nothing to anyone else: another machine has no such
//             record, and this one forgets after 24 hours. It is how an artist
//             looks at their own work, not how they share it.
//
//   SHARE     /viewer?patch=<url>
//             The patch is on the gallery, so the link works for whoever opens
//             it. That means publishing, which is a real act with a real
//             audience — so it is a button someone presses, never something
//             that happens because they opened a panel.
//
// The tool shows both and says which is which, because "I sent the link and my
// friend got an error" is the failure a single unlabelled Copy button produces.

import { serializePatchData, checkPatchSize, stableStringify } from '../core/patchSerializer.js';
import { putHandoff } from '../viewer/patchHandoff.js';
import { APP_VERSION } from '../utils/appVersion.js';
import { resolvePatchUrl, PatchSourceError } from '../viewer/patchSource.js';
import { buildPatch, captureStill, uploadArtwork } from './publish.js';

/** Where the viewer lives, relative to whatever is serving the editor. */
function viewerBase(origin = window.location.origin) {
  return new URL('/viewer', origin);
}

/**
 * The preview link: this patch, from this browser, for the next 24 hours.
 *
 * @param {{origin?: string}} [options]
 * @returns {Promise<{url: string, title: string}>}
 * @throws {Error} when there is nothing on the canvas, or the patch is oversize
 */
export async function makePreviewLink({ origin = window.location.origin } = {}) {
  const { patchData, title: projectName } = buildPatchData();
  const title = linkTitle() || projectName;

  const id = await putHandoff(patchData, { title });
  const url = viewerBase(origin);
  url.searchParams.set('handoff', id);
  if (title) url.searchParams.set('title', title);

  return { url: url.toString(), title };
}

/**
 * The share link for a patch already published to the gallery.
 *
 * Held to the viewer's own allowlist here rather than at the far end, so an
 * artist finds out the URL is wrong while they can still fix it — not from a
 * friend who clicked it.
 *
 * @param {string} patchUrl the `.rz` on the gallery
 * @param {{title?: string, origin?: string}} [options]
 * @returns {string}
 * @throws {PatchSourceError} when the URL is not one the viewer will open
 */
export function makeShareLink(patchUrl, { title = '', origin = window.location.origin } = {}) {
  const value = String(patchUrl || '').trim();

  // resolvePatchUrl resolves a relative value against the page, which is right
  // for a `?patch=` the viewer is handed — but here the value is an address an
  // artist pasted, and "slow-bloom" or a stray sentence would quietly become a
  // same-origin URL that 404s for whoever they send it to. An address of a
  // published patch is absolute; demand that before the allowlist runs.
  if (!/^https?:\/\//i.test(value)) {
    throw new PatchSourceError(
      'Paste the full address of a published patch, starting with https://.',
      'bad_patch_url',
    );
  }

  const resolved = resolvePatchUrl(value, origin);

  const url = viewerBase(origin);
  url.searchParams.set('patch', resolved.toString());
  if (title) url.searchParams.set('title', title);
  return url.toString();
}

/**
 * What a link should call this patch.
 *
 * The page title the artist set in the tool wins over the project name: one is
 * a decision about what visitors see, the other is a filename. Falls back to the
 * project name so a patch whose page was never touched is still labelled.
 */
export function linkTitle() {
  const page = window.viewerPageModel?.get?.().title || '';
  return page || window.saveLoadManager?.getProjectName?.() || '';
}

/** Serialize what is on the canvas, with the checks the gallery would apply. */
function buildPatchData() {
  const manager = window.saveLoadManager;
  if (!manager || typeof manager.exportProject !== 'function') {
    throw new Error('The project could not be read.');
  }

  const projectData = manager.exportProject();
  if (!projectData?.nodes?.length) {
    throw new Error('There is nothing on the canvas to view yet.');
  }

  const title = manager.getProjectName?.() || '';
  const patchData = serializePatchData(projectData, {
    title,
    generatorVersion: APP_VERSION,
  });

  const oversize = checkPatchSize(new Blob([stableStringify(patchData)]));
  if (oversize) throw new Error(oversize);

  return { patchData, title };
}

/**
 * Publish this patch to the gallery and hand back a link that works for anyone.
 *
 * The upload is the ordinary publish upload — a still frame with the `.rz`
 * attached — because that is the pair the gallery stores. A viewer link with no
 * thumbnail behind it is a link to a blank card, and running a second, patch-only
 * upload path would mean two ways for a patch to reach the gallery and two ways
 * for that to go wrong.
 *
 * @param {{onProgress?: (percent: number, message: string, detail?: string) => void,
 *          origin?: string}} [options]
 * @returns {Promise<{shareUrl: string, patchUrl: string, mediaUrl: string,
 *                    publishUrl: string|null, title: string}>}
 * @throws {Error} the gallery's own failure, or PATCH_NOT_STORED below
 */
export async function publishForLink({ onProgress = () => {}, origin = window.location.origin } = {}) {
  const patch = await buildPatch();
  if (patch?.cancelled) throw new Error('Publishing was cancelled.');
  if (!patch) throw new Error('There is nothing on the canvas to publish yet.');

  const still = await captureStill(onProgress);

  onProgress(70, 'Uploading to the gallery…', `${(still.blob.size / 1024).toFixed(0)} KB`);
  const { data, patchDropped } = await uploadArtwork(
    still.blob,
    still.filename,
    (loaded, total) => onProgress(70 + (loaded / total) * 25, 'Uploading to the gallery…',
      `${(loaded / 1024).toFixed(0)} KB / ${(total / 1024).toFixed(0)} KB`),
    patch,
  );

  // A viewer link is a link to the PATCH. Without one there is nothing to point
  // at, and reporting success with the media URL would hand the artist a link
  // that opens a JPEG in the viewer.
  const patchUrl = data?.patchUrl;
  if (patchDropped || !patchUrl) {
    const error = new Error(
      'The artwork was published, but the gallery did not store the patch — so there is ' +
        'nothing for a viewer link to point at yet.',
    );
    error.code = 'PATCH_NOT_STORED';
    error.data = data;
    throw error;
  }

  const title = linkTitle();

  let shareUrl;
  try {
    shareUrl = makeShareLink(patchUrl, { title, origin });
  } catch (cause) {
    // The gallery stored the patch on a host the viewer will not fetch from.
    // Real, fixable, and worth naming exactly — see ALLOWED_PATCH_ORIGINS.
    const error = new Error(
      `The patch was published to ${safeOrigin(patchUrl)}, which the viewer does not open ` +
        'patches from. See ALLOWED_PATCH_ORIGINS in src/viewer/patchSource.js.',
    );
    error.code = cause instanceof PatchSourceError ? cause.code : 'blocked_origin';
    throw error;
  }

  return {
    shareUrl,
    patchUrl,
    mediaUrl: data.url,
    publishUrl: data.publishUrl || null,
    title,
  };
}

function safeOrigin(value) {
  try {
    return new URL(String(value)).origin;
  } catch {
    return 'another host';
  }
}

/**
 * Put a link on the clipboard.
 *
 * The async Clipboard API needs a secure context and a permission that a
 * WebView may simply not grant, so the caller is told whether it worked rather
 * than being left to assume — a Copy button that silently did nothing is worse
 * than one that says to select the field instead.
 *
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}
