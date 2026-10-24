/**
 * publish.js - Share renders to the TenderWorld gallery.
 *
 * Reached from File → Publish. Both entry points capture at the 'export' role's
 * size (see OutputFormat.js), upload the file and open the gallery's publish
 * page for the uploaded asset. An animation can carry the loaded audio track
 * along with it (see ../audio/recordingAudio.js).
 */

import { modalManager } from './ModalManager.js';
import { openExternal } from '../utils/openExternal.js';
import { signInToGallery } from './accountSession.js';
import { GALLERY_ORIGIN, galleryApiUrl } from '../utils/galleryEndpoint.js';
import { desktopAuthHeaders } from '../ai/desktopToken.js';
import { resolveResolution } from './OutputFormat.js';
import { serializePatch, patchFilename, checkPatchSize } from '../core/patchSerializer.js';
import { APP_VERSION } from '../utils/appVersion.js';
import {
  AUDIO_BITRATE,
  applyFrameRate,
  hasRecordableAudio,
  openAudioTap,
  selectRecordingMimeType,
} from '../audio/recordingAudio.js';

/**
 * Where the upload goes.
 *
 * Resolved per call rather than at import: on the Vite dev server this is the
 * same-origin proxy path, and the gallery's own origin everywhere else. The
 * gallery answers this route with no Access-Control-Allow-Origin at all, so a
 * publish from `npm run dev` or `tauri dev` used to fail its preflight before
 * a single byte was sent — see ../utils/galleryEndpoint.js.
 */
function uploadEndpoint() {
  return galleryApiUrl('/api/rhizo-upload');
}

/**
 * Media above this goes straight to the gallery's storage instead of in the
 * upload request. The gallery runs on Vercel, which refuses a request body over
 * 4.5MB before the route ever sees it; this leaves room for the patch and the
 * multipart framing that ride in the same request.
 */
export const DIRECT_UPLOAD_MIN_BYTES = 4 * 1024 * 1024;

/**
 * How large a published video may be. The recording bitrate is scaled to land
 * under it, and a file that still comes out above it asks before uploading.
 * The gallery's own upload limit has to be at least this, or a file the editor
 * was happy with is refused with a 413 after it has been recorded.
 */
const PUBLISH_MAX_VIDEO_MB = 500;

function getPreview() {
  return window.floatingPreview || null;
}

/** Where this page is served from, for an error that has to name it. */
function pageOrigin() {
  try {
    return window.location.origin;
  } catch {
    return null;
  }
}

/**
 * Serialize the current graph as a `.rz` patch to publish alongside the media,
 * so a visitor can download the source document and reopen the work here.
 *
 * Returns null when there is nothing to attach or the export fails: the patch
 * is a bonus on top of the artwork, and losing a finished render because the
 * serializer tripped would be the wrong trade. The oversize case is the one
 * exception — it asks the artist, since silently dropping the patch after they
 * chose to publish it is worse than a question.
 */
export async function buildPatch() {
  const manager = window.saveLoadManager;
  if (!manager || typeof manager.exportProject !== 'function') return null;

  let blob;
  let filename;
  try {
    const projectData = manager.exportProject();
    if (!projectData?.nodes?.length) return null;

    const title = manager.getProjectName?.() || '';
    blob = serializePatch(projectData, { title, generatorVersion: APP_VERSION });
    filename = patchFilename(title, 'rhizomium-patch');
  } catch (err) {
    console.warn('Patch serialization failed, publishing media only:', err);
    return null;
  }

  // Catch oversize here rather than letting the gallery reject it: a 400 after
  // a long render, with the work still only in memory, is a bad place to land.
  const oversize = checkPatchSize(blob);
  if (oversize) {
    const publishAnyway = await modalManager.confirm(
      `${oversize}\n\nPublish the artwork without the patch?`,
      'Patch Too Large',
      { confirmLabel: 'Publish Without Patch', cancelLabel: 'Cancel' }
    );
    if (!publishAnyway) return { cancelled: true };
    return null;
  }

  return { blob, filename };
}

/**
 * The upload never left the browser.
 *
 * XHR reports a blocked cross-origin request and a dead network identically:
 * an `error` event, status 0, no headers, no body — the browser deliberately
 * tells the page nothing about a response CORS refused, and puts the reason in
 * the console only. So this cannot say which of the two it was and does not
 * pretend to; it names both, and names the origin, because "Upload failed"
 * with no origin in it is what turns a one-line configuration fix into an
 * afternoon.
 *
 * A distinct type rather than a bare Error so callers can treat it as the
 * situation it is: `handleUploadError` gives it its own dialog instead of the
 * "Publish failed:" one, `isPatchAttributable` refuses to retry it without the
 * patch, and the web viewer tool points at the preview link, which needs no
 * network. `status` is 0 to match what an XHR that never got a response
 * carries elsewhere in this file.
 *
 * On the Vite dev server the upload goes through the same-origin proxy (see
 * ../utils/galleryEndpoint.js) and cannot hit the CORS case at all, so a
 * blocked upload here means an installed build, or a genuinely dead network.
 */
export class UploadBlockedError extends Error {
  constructor(origin, endpoint) {
    super(
      `The gallery did not accept an upload from ${origin || 'this page'}. ` +
        'Either this machine is offline, or the gallery does not allow that ' +
        'origin (the browser console will say which).'
    );
    this.name = 'UploadBlockedError';
    this.code = 'upload_blocked';
    this.status = 0;
    this.origin = origin || null;
    this.endpoint = endpoint || null;
  }
}

/** The GPU is not in a state to be captured from. Not an upload failure. */
export class CaptureNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CaptureNotReadyError';
  }
}

/**
 * Capture one frame of the current render as a WebP blob.
 *
 * Lifted out of publishImage() so the web viewer tool can reuse it: a viewer
 * link needs a still for the same reason a publish does — the gallery stores
 * the patch beside a piece of media, and a link with no thumbnail behind it is
 * a link to a blank card.
 *
 * A GPU that is not ready to be captured from throws a CaptureNotReadyError:
 * "open the preview first" is a thing the artist can act on, and it deserves a
 * plain sentence rather than the upload-failure treatment.
 *
 * @param {(percent: number, message: string, detail?: string) => void} [onProgress]
 * @returns {Promise<{blob: Blob, filename: string, width: number, height: number}>}
 * @throws {CaptureNotReadyError|Error}
 */
export async function captureStill(onProgress = () => {}) {
  const preview = getPreview();
  const canvas = preview?.gpuCanvas;
  if (!canvas) throw new CaptureNotReadyError('Canvas not available. Open the preview first.');

  if (typeof window.initWebGPU === 'function' && !window._gpuDevice) {
    try {
      await window.initWebGPU(canvas, true);
    } catch {
      // Fall through - the renderer check below reports the real problem.
    }
  }

  const renderer = window.gpuRenderer;
  if (!renderer || typeof renderer.captureFrame !== 'function') {
    throw new CaptureNotReadyError('Renderer not ready. Render the preview at least once.');
  }

  const { width, height } = captureSize(canvas);
  onProgress(20, 'Capturing frame from GPU...', `${width}x${height}`);
  const { pixels, bytesPerRow } = await renderer.captureFrame({ width, height });

  onProgress(40, 'Processing image data...', 'Converting pixel format...');
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    const srcOffset = y * bytesPerRow;
    const dstOffset = y * width * 4;

    for (let x = 0; x < width; x++) {
      const si = srcOffset + x * 4;
      const di = dstOffset + x * 4;

      // Swap B and R channels (BGRA -> RGBA)
      imageData.data[di + 0] = pixels[si + 2];
      imageData.data[di + 1] = pixels[si + 1];
      imageData.data[di + 2] = pixels[si + 0];
      imageData.data[di + 3] = pixels[si + 3];
    }
  }
  ctx.putImageData(imageData, 0, 0);

  onProgress(60, 'Creating image file...', 'Encoding WebP...');
  const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/webp', 0.95));
  if (!blob) throw new Error('Failed to create image blob');

  return { blob, filename: `shader-${Date.now()}.webp`, width, height };
}

function captureSize(canvas) {
  const resolution = resolveResolution('export');
  return {
    width: Math.max(1, Math.floor(resolution.width || canvas?.width || 1)),
    height: Math.max(1, Math.floor(resolution.height || canvas?.height || 1)),
  };
}

/**
 * Send media to the gallery's storage directly, resolving with its path.
 *
 * Three steps: the gallery signs an upload for one path in the artist's own
 * folder (`/api/rhizo-upload/sign`, name and size only); the bytes go to
 * Supabase's resumable endpoint in chunks, so a dropped chunk is retried rather
 * than costing the whole video; and the caller then hands the path to
 * `/api/rhizo-upload` as `mediaPath`, where the gallery checks what was stored.
 *
 * Resolves with null when the gallery has no signing route yet (404), so the
 * caller can fall back to the single request an older gallery understands.
 */
async function uploadMediaDirect(blob, filename, onProgress) {
  const endpoint = galleryApiUrl('/api/rhizo-upload/sign');
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...desktopAuthHeaders() },
      body: JSON.stringify({ filename, size: blob.size }),
    });
  } catch {
    throw new UploadBlockedError(pageOrigin(), endpoint);
  }
  if (res.status === 404) return null;

  const slot = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = slot?.error || '';
    const err = new Error(detail ? `${detail} (${res.status})` : `Upload failed (${res.status})`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  await resumableUpload(blob, slot, onProgress);
  return slot.path;
}

/** Waits before each retry of a failed chunk; one entry per retry. */
const RESUMABLE_RETRY_DELAYS_MS = [0, 1000, 3000, 5000];

/**
 * The tus protocol, as much of it as Supabase's resumable endpoint needs.
 *
 * Written out rather than taken from tus-js-client: the editor is also served
 * unbundled, where a bare package import cannot resolve (see
 * tests/unbundledBareImports.test.js). It is small: one POST creates the
 * upload and names it in `Location`, then each chunk is a PATCH at the offset
 * the server last confirmed. A chunk that fails on the network or with a 5xx is
 * retried after asking the server (HEAD) how much it really has, so a dropped
 * connection costs one chunk, not the video. A 4xx is a refusal and is final.
 */
async function resumableUpload(blob, slot, onProgress) {
  const auth = { apikey: slot.apiKey, 'x-signature': slot.token, 'Tus-Resumable': '1.0.0' };
  const metadata = {
    bucketName: slot.bucket,
    objectName: slot.path,
    contentType: slot.contentType,
    cacheControl: '3600',
  };

  const created = await withRetries(() =>
    fetch(slot.resumableUrl, {
      method: 'POST',
      headers: {
        ...auth,
        'x-upsert': 'false',
        'Upload-Length': String(blob.size),
        'Upload-Metadata': Object.entries(metadata)
          .map(([key, value]) => `${key} ${base64(value)}`)
          .join(','),
      },
    }));
  const location = created.headers.get('Location');
  if (!location) throw new Error('Upload failed: storage did not say where to send the file.');
  const uploadUrl = new URL(location, slot.resumableUrl).href;

  let offset = 0;
  let failures = 0;
  while (offset < blob.size) {
    let res = null;
    try {
      res = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          ...auth,
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: blob.slice(offset, offset + slot.chunkSize),
      });
    } catch {
      // Network failure: retried below like a 5xx.
    }

    if (res?.ok) {
      const confirmed = Number(res.headers.get('Upload-Offset'));
      offset = Number.isFinite(confirmed) && confirmed > offset
        ? confirmed
        : Math.min(blob.size, offset + slot.chunkSize);
      failures = 0;
      onProgress?.(offset, blob.size);
      continue;
    }

    // 409 is tus for "not the offset I have", which the HEAD below resolves.
    if (res && res.status < 500 && res.status !== 409) throw await storageUploadError(res);
    if (failures >= RESUMABLE_RETRY_DELAYS_MS.length) throw await storageUploadError(res);
    await sleep(RESUMABLE_RETRY_DELAYS_MS[failures++]);

    // Resume from what the server has rather than from what we sent: the
    // failed request may have landed some or all of the chunk.
    try {
      const head = await fetch(uploadUrl, { method: 'HEAD', headers: auth });
      const confirmed = Number(head.headers.get('Upload-Offset'));
      if (head.ok && Number.isFinite(confirmed)) offset = confirmed;
    } catch {
      // Could not ask; the retry itself will say whether storage is back.
    }
  }
}

/**
 * Run a storage request, retrying a network failure or a 5xx. Resolves with
 * the successful response; rejects with storage's own reason otherwise.
 */
async function withRetries(send) {
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try {
      res = await send();
    } catch {
      // Network failure: retried like a 5xx.
    }
    if (res?.ok) return res;
    if (res && res.status < 500) throw await storageUploadError(res);
    if (attempt >= RESUMABLE_RETRY_DELAYS_MS.length) throw await storageUploadError(res);
    await sleep(RESUMABLE_RETRY_DELAYS_MS[attempt]);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** tus metadata values are base64, of UTF-8. */
function base64(value) {
  let binary = '';
  for (const byte of new TextEncoder().encode(String(value))) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * An Error for a failed storage request, carrying storage's own reason. Storage
 * answers a refusal with JSON ("The object exceeded the maximum allowed size");
 * a failure with no response at all never reached it.
 */
async function storageUploadError(res) {
  if (!res) {
    const err = new Error('Upload failed: could not reach the gallery storage. Check your connection and try again.');
    err.status = 0;
    return err;
  }
  const text = await res.text().catch(() => '');
  let detail = text;
  try {
    const body = JSON.parse(text);
    detail = body.message || body.error || '';
  } catch {
    // Not JSON; the text is the reason, if there is one.
  }
  const err = res.status === 413
    ? new Error(`File too large for the gallery storage.${detail ? ` (${detail})` : ''}`)
    : new Error(`Upload failed (${res.status})${detail ? `: ${detail}` : ''}`);
  err.status = res.status;
  err.detail = detail;
  return err;
}

/**
 * Upload the media (and, when present, the `.rz` patch) with progress
 * reporting. Resolves with the parsed response.
 *
 * `media` is either `{blob, filename}`, sent in this request, or `{path}`, for
 * media uploadMediaDirect already put in storage.
 *
 * Both objects go in one request: that is a single round trip and one shared
 * timestamp, so the gallery stores them as a matched pair.
 *
 * Authentication is whichever of the two the caller has. `withCredentials`
 * carries the gallery's session cookie, which is what a browser on a
 * tenderworld.org host has; the desktop app is a different site and never gets
 * one, so it carries a bearer token instead (desktopToken.js). This sent
 * neither header and relied on the cookie alone, which meant a paired desktop
 * app could read its entitlements and then not publish — the request arrived
 * anonymous and the gallery answered 401.
 */
function uploadBlob(media, onProgress, patch = null) {
  const formData = new FormData();
  if (media.path) formData.append('mediaPath', media.path);
  else formData.append('file', media.blob, media.filename);
  if (patch) formData.append('patch', patch.blob, patch.filename);

  const xhr = new XMLHttpRequest();
  const uploadPromise = new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve({});
        }
      } else if (xhr.status === 413) {
        const fileSizeMB = (media.blob?.size || 0) / 1024 / 1024;
        const err = new Error(`File too large (${fileSizeMB.toFixed(2)} MB). Server limit exceeded. Try a smaller export size.`);
        err.status = xhr.status;
        reject(err);
      } else {
        // The gallery explains 400s (bad type, oversize) in the body; surface
        // that rather than a bare status the artist can do nothing with.
        let detail = '';
        try {
          detail = JSON.parse(xhr.responseText)?.error || '';
        } catch {
          // Non-JSON error body - fall back to the status code alone.
        }
        const err = new Error(detail ? `${detail} (${xhr.status})` : `Upload failed (${xhr.status})`);
        err.status = xhr.status;
        err.detail = detail;
        reject(err);
      }
    });

    // status 0 and no response: the request never reached the gallery, so
    // there is nothing to read a reason out of. The browser knows why (a
    // refused preflight, a dropped connection) and tells the console only, so
    // name the two things it can be rather than showing a bare "Upload
    // failed" the artist can do nothing with.
    xhr.addEventListener('error', () =>
      reject(new UploadBlockedError(pageOrigin(), uploadEndpoint())));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
  });

  xhr.open('POST', uploadEndpoint());
  // The web session is a cookie the browser attaches; the desktop app has no
  // cookie the gallery will honour and carries a bearer token instead. Set it
  // after open() and before send(), which is the only window in which
  // setRequestHeader is legal.
  xhr.withCredentials = true;
  for (const [name, value] of Object.entries(desktopAuthHeaders())) {
    xhr.setRequestHeader(name, value);
  }
  xhr.send(formData);

  return uploadPromise;
}

/** Toast text for a finished upload, saying plainly whether the patch made it. */
export function describeUpload(kind, patch, patchDropped) {
  if (patchDropped) {
    return `${kind} uploaded — but the gallery could not store the patch, so it was left off.`;
  }
  if (patch) return `${kind} and patch uploaded! Opening publish page...`;
  return `${kind} uploaded successfully! Opening publish page...`;
}

/**
 * Is this failure plausibly the patch's fault rather than the artwork's?
 *
 * The gallery names the patch when it is the problem ("Patch upload failed:
 * Bucket not found"), and a 500 is a storage/server fault that a media-only
 * request may well survive — a gallery whose `patches` bucket has not been
 * provisioned yet fails exactly this way. Auth and payload-size failures are
 * excluded: they will fail identically without the patch, so retrying would
 * only re-upload the media for nothing.
 */
export function isPatchAttributable(err) {
  if (!err || err.status === 401 || err.status === 413) return false;
  // A request the browser never sent was not refused over its contents. Retrying
  // it without the patch spends a second upload to fail identically.
  if (err.code === 'upload_blocked') return false;
  return /patch/i.test(err.message || '') || err.status === 500;
}

/**
 * Upload the artwork, dropping the patch rather than the publish if the patch
 * is what the gallery choked on.
 *
 * The patch is a bonus attached to the artwork; a gallery that cannot store it
 * must not cost the artist a finished render. Resolves with the response plus
 * `patchDropped`, so the caller can tell the artist what they actually got.
 */
export async function uploadArtwork(blob, filename, onProgress, patch) {
  let media = { blob, filename };
  let requestProgress = onProgress;
  if (blob.size > DIRECT_UPLOAD_MIN_BYTES) {
    const path = await uploadMediaDirect(blob, filename, onProgress);
    if (path) {
      media = { path };
      // The media's progress has been reported; what is left is the patch, and
      // starting the bar again from zero for it would read as a second upload.
      requestProgress = null;
    }
  }

  try {
    const data = await uploadBlob(media, requestProgress, patch);
    return { data, patchDropped: false };
  } catch (err) {
    if (!patch || !isPatchAttributable(err)) throw err;

    console.warn('Patch rejected by the gallery, retrying without it:', err);
    // Only the request is repeated: media already in storage is named again by
    // its path, not uploaded twice.
    const data = await uploadBlob(media, requestProgress, null);
    return { data, patchDropped: true, patchError: err };
  }
}

/**
 * Open the gallery's publish page for an upload.
 *
 * Prefer the `publishUrl` the endpoint returns: it is assembled server-side
 * with the media, patch and patch-name parameters already encoded, so building
 * it here would only risk dropping the patch. The manual URL is the fallback
 * for an older gallery that does not send one.
 */
function openPublishPage(data) {
  const url = data?.publishUrl
    || `${GALLERY_ORIGIN}/gallery/publish?url=${encodeURIComponent(data?.url || '')}`;
  // Not window.open(): the desktop webview refuses it and the artist would be
  // told their work was published with no page to finish publishing it on.
  openExternal(url, { label: 'gallery-publish', title: 'Rhizomium — Publish' })
    .then((page) => {
      if (page) return;
      modalManager.toast(
        `The publish page could not be opened. It is at ${url}`,
        'warning',
        'Publish',
      );
    })
    .catch((error) => console.warn('[publish] Could not open the publish page:', error));
}

async function handleUploadError(err, sizeHint) {
  const message = err?.message || String(err);

  if (message.includes('401') || message.includes('Unauthorized')) {
    const shouldSignIn = await modalManager.confirm(
      'You need to sign in to share your work.\n\nWould you like to go to the gallery and sign in?',
      'Sign In Required'
    );
    if (!shouldSignIn) return;

    // Goes through the account flow rather than opening a link, because in the
    // desktop app a link is not a route to a session: the sign-in has to happen
    // in a window this application owns for the cookie to be one the editor can
    // use. See accountSession.js.
    const signedIn = await signInToGallery();
    if (signedIn) {
      modalManager.toast('Signed in. Publish again to share this work.', 'success', 'Account');
    }
    return;
  }

  if (message.includes('413') || message.includes('too large') || message.includes('File too large')) {
    await modalManager.alert(
      `Upload failed: file is too large.\n\n${sizeHint}\n\nPublished videos can be up to ${PUBLISH_MAX_VIDEO_MB} MB.`,
      'File Too Large'
    );
    return;
  }

  if (err instanceof UploadBlockedError) {
    await modalManager.alert(message, 'The gallery could not be reached');
    return;
  }

  await modalManager.alert(`Publish failed: ${message}`, 'Upload Error');
}

/** Capture the current frame and publish it to the gallery. */
export async function publishImage() {
  // Serialize the patch before the progress dialog opens: it can ask about an
  // oversize patch, and stacking that on top of a progress modal reads badly.
  const patch = await buildPatch();
  if (patch?.cancelled) return;

  const progress = modalManager.showProgress('Publishing Image', 'Capturing frame...');
  let still = null;

  try {
    still = await captureStill((percent, message, detail) =>
      progress.update(percent, message, detail));

    progress.update(
      70,
      'Preparing upload...',
      `File size: ${(still.blob.size / 1024).toFixed(2)} KB` +
        (patch ? ` + patch ${(patch.blob.size / 1024).toFixed(2)} KB` : '')
    );

    const { data, patchDropped } = await uploadArtwork(still.blob, still.filename, (loaded, total) => {
      progress.update(
        70 + (loaded / total) * 25,
        'Uploading to gallery...',
        `${(loaded / 1024).toFixed(2)} KB / ${(total / 1024).toFixed(2)} KB`
      );
    }, patch);

    if (!data.url) throw new Error('No URL returned from upload');

    progress.update(100, 'Upload complete!', 'Opening publish page...');
    setTimeout(() => {
      progress.close();
      modalManager.toast(
        describeUpload('Image', patch, patchDropped),
        patchDropped ? 'warning' : 'success',
        'Share to Gallery'
      );
      openPublishPage(data);
    }, 500);
  } catch (err) {
    progress.close();
    if (err instanceof CaptureNotReadyError) {
      await modalManager.alert(err.message, 'Error');
      return;
    }
    const fileSizeMB = (still?.blob?.size || 0) / 1024 / 1024;
    const at = still ? ` at ${still.width}x${still.height}` : '';
    await handleUploadError(
      err,
      `Size: ${fileSizeMB.toFixed(2)} MB${at}. Lower the export size in View → Preview / Export Settings.`
    );
  }
}

/**
 * Record an animation at the export resolution and publish it to the gallery.
 *
 * When an audio file is loaded, the recording can carry it: the track is tapped
 * from the same audio graph the reactive nodes read (see recordingAudio.js), so
 * the published video plays the music its visuals are moving to.
 */
export async function publishAnimation() {
  const preview = getPreview();
  const canvas = preview?.gpuCanvas;
  if (!canvas || typeof canvas.captureStream !== 'function') {
    await modalManager.alert('Canvas streaming is not supported in this browser.', 'Browser Compatibility');
    return;
  }
  if (typeof MediaRecorder === 'undefined') {
    await modalManager.alert('MediaRecorder API is not available. Try a Chromium-based browser.', 'Browser Compatibility');
    return;
  }

  if (typeof window.initWebGPU === 'function' && !window._gpuDevice) {
    try {
      await window.initWebGPU(canvas, true);
    } catch {
      // Fall through - the renderer check below reports the real problem.
    }
  }

  const renderer = window.gpuRenderer;
  if (!renderer || typeof renderer.render !== 'function') {
    await modalManager.alert('GPU renderer not ready. Render the preview before publishing an animation.', 'Error');
    return;
  }

  const { width: targetWidth, height: targetHeight } = captureSize(canvas);

  const originalWidth = canvas.width;
  const originalHeight = canvas.height;
  const originalStyleWidth = canvas.style.width;
  const originalStyleHeight = canvas.style.height;

  const defaultFps = Math.max(1, preview?.settings?.settings?.refreshRate || 60);
  const fpsInput = await modalManager.prompt('Frames per second for the recording (1-120)?', 'Animation Settings', String(defaultFps), {
    inputType: 'number',
    placeholder: '60',
    validator: (value) => {
      const fps = Number(value);
      if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
        return 'Please enter a valid FPS value between 1 and 120';
      }
      return null;
    }
  });
  if (fpsInput === null) return;

  const fps = Math.min(120, Math.max(1, Number(fpsInput)));

  const durationInput = await modalManager.prompt('Duration in seconds (1-300)?', 'Animation Settings', '5', {
    inputType: 'number',
    placeholder: '5',
    validator: (value) => {
      const duration = Number(value);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 300) {
        return 'Please enter a valid duration between 1 and 300 seconds';
      }
      return null;
    }
  });
  if (durationInput === null) return;

  const duration = Math.min(300, Math.max(1, Number(durationInput)));

  // Offer the loaded audio track. Only asked when there is one: an artist with
  // no audio in the patch should not have to dismiss a question about it.
  const audioCapture = window.audioCapture;
  let audioTap = null;
  if (hasRecordableAudio(audioCapture)) {
    const includeAudio = await modalManager.confirm(
      'Record the loaded audio track with the animation?\n\n' +
      'The video will carry the music your patch is reacting to. Playback starts from where the playhead sits now.',
      'Audio',
      { confirmLabel: 'Include Audio', cancelLabel: 'No Audio' }
    );
    if (includeAudio) {
      try {
        audioTap = await openAudioTap(audioCapture);
      } catch (err) {
        console.warn('Could not tap the audio graph, recording without sound:', err);
      }
      if (!audioTap) {
        modalManager.toast('Audio could not be captured — recording video only.', 'warning', 'Audio');
      }
    }
  }

  // Prefer MP4/H.264, fall back to WebM where it is unavailable. The container
  // has to be chosen knowing whether an audio track is coming: a video-only
  // mime type drops the track without a word.
  const mimeType = selectRecordingMimeType({ withAudio: !!audioTap });

  if (!mimeType) {
    audioTap?.stop();
    await modalManager.alert('No supported video encoder found for this browser.', 'Browser Compatibility');
    return;
  }

  if (!mimeType.includes('mp4')) {
    console.warn(`MP4/H.264 not available, using fallback: ${mimeType}.`);
  }

  const fileExt = mimeType.includes('mp4') ? 'mp4' : 'webm';

  // Bitrate tuned per-resolution so uploads stay under the server limit.
  const pixels = targetWidth * targetHeight;
  const megapixels = pixels / 1_000_000;

  let baseBitrate;
  if (megapixels <= 1) {
    baseBitrate = pixels * 1.5;
  } else if (megapixels <= 2.5) {
    baseBitrate = pixels * 1.2;
  } else if (megapixels <= 8) {
    baseBitrate = pixels * 1.0;
  } else {
    baseBitrate = pixels * 0.8;
  }

  const fpsMultiplier = Math.max(1, Math.sqrt(fps / 30));
  const estimatedBitrate = Math.floor(baseBitrate * fpsMultiplier);
  // The audio rides in the same file, so it comes out of the same budget.
  const audioBitrate = audioTap ? AUDIO_BITRATE : 0;
  const estimatedFileSizeMB = ((estimatedBitrate + audioBitrate) * duration) / (8 * 1024 * 1024);
  const maxTargetSizeMB = PUBLISH_MAX_VIDEO_MB;

  let adaptiveBitrate = estimatedBitrate;
  if (estimatedFileSizeMB > maxTargetSizeMB) {
    const scaleFactor = maxTargetSizeMB / estimatedFileSizeMB;
    adaptiveBitrate = Math.floor(estimatedBitrate * scaleFactor * 0.95);
  }
  adaptiveBitrate = Math.max(1_000_000, Math.min(50_000_000, adaptiveBitrate));

  // Serialize the patch before recording rather than after: an oversize patch
  // should be caught in seconds, not once the artist has waited out a full
  // render. The graph does not change while recording, so this is the same
  // patch we would produce afterwards.
  const patch = await buildPatch();
  if (patch?.cancelled) {
    audioTap?.stop();
    return;
  }

  const progress = modalManager.showProgress('Publishing Animation', 'Preparing export...');

  try {
    progress.update(5, 'Resizing canvas to export resolution...', `${targetWidth}x${targetHeight}`);

    const gpuRenderer = window.gpuRenderer;
    if (gpuRenderer && gpuRenderer.resizeCanvasSync) {
      await gpuRenderer.resizeCanvasSync(targetWidth, targetHeight);
    } else {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    preview?.updateSize?.();

    progress.update(8, 'Initializing renderer...', '');

    if (typeof window.render === 'function') {
      window.render();
    } else {
      renderer.render();
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));

    const estimatedSizeMB = (((adaptiveBitrate + audioBitrate) * duration) / (8 * 1024 * 1024)).toFixed(1);
    progress.update(
      10,
      'Starting recording...',
      `Codec: ${mimeType.split(';')[0]} @ ${fps} FPS | Bitrate: ${(adaptiveBitrate / 1_000_000).toFixed(1)} Mbps` +
        `${audioTap ? ' + audio' : ''} | Est. size: ~${estimatedSizeMB} MB`
    );

    const stream = canvas.captureStream(fps);

    // Frame-rate constraint keeps MP4 playback speed correct.
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack?.applyConstraints) {
      try {
        await videoTrack.applyConstraints({ frameRate: { ideal: fps, max: fps } });
      } catch (err) {
        console.warn('Could not set frame rate constraint:', err);
      }
    }

    // The canvas stream is pixels only; the audio joins it here.
    if (audioTap) stream.addTrack(audioTap.track);

    const chunks = [];

    const mainRenderLoop = window.renderLoop;
    const wasPaused = mainRenderLoop?.paused || false;
    if (mainRenderLoop && typeof mainRenderLoop.pause === 'function') {
      mainRenderLoop.pause();
    }

    // Non-blocking render pump throttled to the target FPS.
    let renderRequestId = null;
    let isRecording = true;
    const frameIntervalMs = 1000 / fps;
    let lastRenderTime = performance.now();

    const renderPump = (currentTime) => {
      if (!isRecording) return;

      if (currentTime - lastRenderTime >= frameIntervalMs) {
        try {
          if (typeof window.render === 'function') {
            window.render();
          } else if (renderer?.render) {
            renderer.render();
          }
        } catch (error) {
          console.warn('Render tick failed during animation publish:', error);
        }
        lastRenderTime = currentTime;
      }

      renderRequestId = requestAnimationFrame(renderPump);
    };

    renderRequestId = requestAnimationFrame(renderPump);

    // Warm up a few frames before recording starts.
    for (let i = 0; i < 3; i++) {
      if (typeof window.render === 'function') {
        window.render();
      } else if (renderer?.render) {
        renderer.render();
      }
      await new Promise((resolve) => setTimeout(resolve, frameIntervalMs));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    let recorder;
    try {
      const recorderOptions = {
        mimeType: applyFrameRate(mimeType, fps),
        videoBitsPerSecond: adaptiveBitrate,
      };
      if (audioTap) recorderOptions.audioBitsPerSecond = AUDIO_BITRATE;
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch (error) {
      isRecording = false;
      if (renderRequestId) cancelAnimationFrame(renderRequestId);
      if (mainRenderLoop && typeof mainRenderLoop.start === 'function' && !wasPaused) {
        mainRenderLoop.start();
      }
      stream.getTracks().forEach((track) => track.stop());
      progress.close();
      await modalManager.alert('Unable to start recorder: ' + error.message, 'Recording Error');
      return;
    }

    const recordingPromise = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onerror = (event) => reject(event.error || new Error('Recording error'));
      recorder.onstop = () => resolve();
    });

    // Roll the music last: started any earlier, the seconds spent resizing the
    // canvas and warming up frames would play out before the recorder is
    // listening, and the video would open mid-phrase.
    if (audioTap) {
      try {
        await audioTap.startPlayback();
      } catch (err) {
        console.warn('Could not start audio playback for the recording:', err);
      }
    }

    recorder.start(100);

    const startTime = Date.now();
    const totalDurationMs = duration * 1000;

    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progressPercent = Math.min(70, 10 + (elapsed / totalDurationMs) * 60);
      const remaining = Math.max(0, duration - elapsed / 1000);
      const capturedMB = chunks.reduce((sum, c) => sum + c.size, 0) / 1024 / 1024;

      progress.update(
        progressPercent,
        `Recording... ${remaining.toFixed(1)}s remaining`,
        `${capturedMB.toFixed(2)} MB captured`
      );
    }, 100);

    const stopTimer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, totalDurationMs);

    try {
      await recordingPromise;
      clearInterval(progressInterval);
    } catch (error) {
      clearInterval(progressInterval);
      console.error('Animation recording failed:', error);
      progress.close();
      await modalManager.alert('Animation recording failed: ' + error.message, 'Recording Error');
      return;
    } finally {
      clearTimeout(stopTimer);
      isRecording = false;
      if (renderRequestId) cancelAnimationFrame(renderRequestId);
      if (mainRenderLoop && typeof mainRenderLoop.start === 'function' && !wasPaused) {
        mainRenderLoop.start();
      }
      stream.getTracks().forEach((track) => track.stop());
    }

    if (!chunks.length) {
      progress.close();
      await modalManager.alert('Recording produced no data.', 'Recording Error');
      return;
    }

    progress.update(70, 'Creating video file...', 'Processing chunks...');

    const blob = new Blob(chunks, { type: mimeType });
    const filename = `shader-${targetWidth}x${targetHeight}-${fps}fps-${Date.now()}.${fileExt}`;
    const fileSizeMB = blob.size / 1024 / 1024;
    const maxFileSizeMB = PUBLISH_MAX_VIDEO_MB;

    progress.update(80, 'Preparing upload...', `File size: ${fileSizeMB.toFixed(2)} MB`);

    if (fileSizeMB > maxFileSizeMB) {
      progress.close();
      const shouldContinue = await modalManager.confirm(
        `Warning: file size is ${fileSizeMB.toFixed(2)} MB, above the typical upload limit (${maxFileSizeMB} MB).\n\n` +
        `To reduce it, lower the render resolution (currently ${targetWidth}x${targetHeight}), the FPS (${fps}) or the duration.\n\n` +
        `Upload anyway?`,
        'File Too Large',
        { confirmLabel: 'Try Upload', cancelLabel: 'Cancel' }
      );
      if (!shouldContinue) return;
      progress.update(80, 'Preparing upload...', `File size: ${fileSizeMB.toFixed(2)} MB (large)`);
    }

    try {
      progress.update(80, 'Uploading to gallery...', 'Please wait...');

      const { data, patchDropped } = await uploadArtwork(blob, filename, (loaded, total) => {
        progress.update(
          80 + (loaded / total) * 15,
          'Uploading to gallery...',
          `${(loaded / 1024 / 1024).toFixed(2)} MB / ${(total / 1024 / 1024).toFixed(2)} MB`
        );
      }, patch);

      if (!data.url) throw new Error('No URL returned from upload');

      progress.update(100, 'Upload complete!', 'Opening publish page...');
      setTimeout(() => {
        progress.close();
        modalManager.toast(
          describeUpload('Animation', patch, patchDropped),
          patchDropped ? 'warning' : 'success',
          'Share to Gallery'
        );
        openPublishPage(data);
      }, 500);
    } catch (err) {
      progress.close();
      console.error('Upload failed:', err);
      await handleUploadError(
        err,
        `Size: ${fileSizeMB.toFixed(2)} MB at ${targetWidth}x${targetHeight}, ${fps} FPS, ${duration}s.`
      );
    } finally {
      const activeRenderer = window.gpuRenderer;
      if (activeRenderer && activeRenderer.resizeCanvasSync) {
        await activeRenderer.resizeCanvasSync(originalWidth, originalHeight);
      } else {
        canvas.width = originalWidth;
        canvas.height = originalHeight;
      }
      canvas.style.width = originalStyleWidth;
      canvas.style.height = originalStyleHeight;
      preview?.updateSize?.();
    }
  } catch (err) {
    progress.close();
    // Restore the canvas even when the capture itself blew up.
    const activeRenderer = window.gpuRenderer;
    if (activeRenderer && activeRenderer.resizeCanvasSync) {
      await activeRenderer.resizeCanvasSync(originalWidth, originalHeight);
    } else {
      canvas.width = originalWidth;
      canvas.height = originalHeight;
    }
    canvas.style.width = originalStyleWidth;
    canvas.style.height = originalStyleHeight;
    preview?.updateSize?.();
    throw err;
  } finally {
    // Covers every way out of the block above, including the early returns for
    // an empty recording or a declined oversize upload: the tap must never
    // outlive the recording, and the playhead goes back where the artist
    // left it.
    audioTap?.stop();
  }
}
