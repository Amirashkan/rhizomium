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

function getPreview() {
  return window.floatingPreview || null;
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
async function buildPatch() {
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

function captureSize(canvas) {
  const resolution = resolveResolution('export');
  return {
    width: Math.max(1, Math.floor(resolution.width || canvas?.width || 1)),
    height: Math.max(1, Math.floor(resolution.height || canvas?.height || 1)),
  };
}

/**
 * Upload the media (and, when present, the `.rz` patch) with progress
 * reporting. Resolves with the parsed response.
 *
 * Both objects go in one request: that is a single round trip and one shared
 * timestamp, so the gallery stores them as a matched pair.
 */
function uploadBlob(blob, filename, onProgress, patch = null) {
  const formData = new FormData();
  formData.append('file', blob, filename);
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
        const fileSizeMB = blob.size / 1024 / 1024;
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
    xhr.addEventListener('error', () => {
      const err = new Error(
        `The gallery did not accept an upload from ${window.location.origin}. ` +
        'Either this machine is offline, or the gallery does not allow that ' +
        'origin (the browser console will say which).'
      );
      err.status = 0;
      reject(err);
    });
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
  try {
    const data = await uploadBlob(blob, filename, onProgress, patch);
    return { data, patchDropped: false };
  } catch (err) {
    if (!patch || !isPatchAttributable(err)) throw err;

    console.warn('Patch rejected by the gallery, retrying without it:', err);
    const data = await uploadBlob(blob, filename, onProgress, null);
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
      `Upload failed: file is too large.\n\n${sizeHint}\n\nThe server limit is around 50-100 MB.`,
      'File Too Large'
    );
    return;
  }

  await modalManager.alert(`Publish failed: ${message}`, 'Upload Error');
}

/** Capture the current frame and publish it to the gallery. */
export async function publishImage() {
  const preview = getPreview();
  const canvas = preview?.gpuCanvas;
  if (!canvas) {
    await modalManager.alert('Canvas not available. Open the preview first.', 'Error');
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
  if (!renderer || typeof renderer.captureFrame !== 'function') {
    await modalManager.alert('Renderer not ready. Render the preview at least once.', 'Error');
    return;
  }

  // Serialize the patch before the progress dialog opens: it can ask about an
  // oversize patch, and stacking that on top of a progress modal reads badly.
  const patch = await buildPatch();
  if (patch?.cancelled) return;

  const { width, height } = captureSize(canvas);
  const progress = modalManager.showProgress('Publishing Image', 'Capturing frame...');
  let blob = null;

  try {
    progress.update(20, 'Capturing frame from GPU...', `${width}x${height}`);
    const { pixels, bytesPerRow } = await renderer.captureFrame({ width, height });

    progress.update(40, 'Processing image data...', 'Converting pixel format...');
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

    progress.update(60, 'Creating image file...', 'Encoding WebP...');
    blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/webp', 0.95));
    if (!blob) {
      progress.close();
      await modalManager.alert('Failed to create image blob', 'Error');
      return;
    }

    const filename = `shader-${Date.now()}.webp`;
    progress.update(
      70,
      'Preparing upload...',
      `File size: ${(blob.size / 1024).toFixed(2)} KB` +
        (patch ? ` + patch ${(patch.blob.size / 1024).toFixed(2)} KB` : '')
    );

    const { data, patchDropped } = await uploadArtwork(blob, filename, (loaded, total) => {
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
    const fileSizeMB = (blob?.size || 0) / 1024 / 1024;
    await handleUploadError(
      err,
      `Size: ${fileSizeMB.toFixed(2)} MB at ${width}x${height}. Lower the export size in View → Preview / Export Settings.`
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
  const maxTargetSizeMB = 50;

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
    const maxFileSizeMB = 100;

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
