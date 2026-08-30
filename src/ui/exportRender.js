/**
 * exportRender.js - Save the render to a local file (PNG frame / video).
 *
 * Reached from File → Export, which opens the export panel, and from the
 * Preview / Export Settings window. Both capture at the 'export' role's size
 * (see OutputFormat.js): the output format, or the per-export override. The
 * internal sims keep their own authored resolution - only the composite is
 * re-rendered at this size.
 *
 * Everything else about an export - length, frame rate, bitrate, audio, the
 * file's name - arrives as an options object, defaulting to what the artist set
 * in the panel (exportSettings.js). Nothing here asks a question mid-export:
 * a recording that stops to ask how long it should be is a recording the artist
 * has to stand over, and the answers belong on the panel where they can be seen
 * together and changed before anything starts.
 */

import { modalManager } from './ModalManager.js';
import { resolveResolution } from './OutputFormat.js';
import {
  AUDIO_BITRATE,
  applyFrameRate,
  hasRecordableAudio,
  openAudioTap,
  selectRecordingMimeType,
} from '../audio/recordingAudio.js';
import {
  buildExportFilename,
  formatFileSize,
  getExportSettings,
  resolveVideoBitrate,
} from './exportSettings.js';

function getPreview() {
  return window.floatingPreview || null;
}

function captureSize(canvas) {
  const resolution = resolveResolution('export');
  return {
    width: Math.max(1, Math.floor(resolution.width || canvas?.width || 1)),
    height: Math.max(1, Math.floor(resolution.height || canvas?.height || 1)),
  };
}

/** Copy a captured BGRA buffer into a 2D canvas as RGBA. */
function blitCapture({ pixels, bytesPerRow }, width, height) {
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
  return exportCanvas;
}

function downloadBlob(blob, filename, revokeAfterMs = 100) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), revokeAfterMs);
  return link.download;
}

/**
 * Can this browser record the canvas at all? The panel asks before the artist
 * has set anything up, so the answer can be shown next to the Export button
 * rather than sprung on them after a click.
 */
export function isVideoExportSupported() {
  const canvas = getPreview()?.gpuCanvas;
  return !!(
    canvas &&
    typeof canvas.captureStream === 'function' &&
    typeof MediaRecorder !== 'undefined' &&
    selectRecordingMimeType({ withAudio: false })
  );
}

/** Is there a loaded audio track a recording could carry? */
export function canRecordAudio() {
  return hasRecordableAudio(window.audioCapture);
}

/**
 * Bring the GPU up if it is not, and confirm the renderer can do the asked-for
 * work. Returns the canvas and renderer, or null after reporting why not.
 */
async function prepareRenderer(need = 'captureFrame') {
  const canvas = getPreview()?.gpuCanvas;
  if (!canvas) {
    await modalManager.alert('Canvas not available. Make sure the preview window is open.', 'Error');
    return null;
  }

  if (typeof window.initWebGPU === 'function' && !window._gpuDevice) {
    try {
      await window.initWebGPU(canvas, true);
    } catch {
      // Fall through - the renderer check below reports the real problem.
    }
  }

  const renderer = window.gpuRenderer;
  if (!renderer || typeof renderer[need] !== 'function') {
    await modalManager.alert(
      'GPU renderer not ready. Render the preview at least once before exporting.',
      'Error'
    );
    return null;
  }

  return { canvas, renderer };
}

/**
 * Capture the current frame and download it as a PNG.
 *
 * @param {object} [options] filenamePrefix; anything else comes from the panel.
 * @returns {Promise<{ok: boolean, filename?: string, error?: string}>}
 */
export async function exportPNG(options = {}) {
  const settings = { ...getExportSettings(), ...options };

  const ready = await prepareRenderer('captureFrame');
  if (!ready) return { ok: false, error: 'renderer-not-ready' };

  const { canvas, renderer } = ready;
  const { width, height } = captureSize(canvas);
  const progress = modalManager.showProgress('Exporting PNG', 'Capturing frame...');

  try {
    progress.update(30, 'Capturing frame from GPU...', `${width}x${height}`);
    const capture = await renderer.captureFrame({ width, height });

    progress.update(50, 'Processing image data...', 'Converting pixel format...');
    const exportCanvas = blitCapture(capture, width, height);

    progress.update(80, 'Creating PNG file...', 'Encoding image...');
    const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      progress.close();
      await modalManager.alert('Failed to create image blob', 'Error');
      return { ok: false, error: 'encode-failed' };
    }

    progress.update(95, 'Preparing download...', `File size: ${formatFileSize(blob.size)}`);

    const filename = downloadBlob(
      blob,
      buildExportFilename({
        prefix: settings.filenamePrefix,
        width,
        height,
        extension: 'png',
      })
    );

    progress.update(100, 'Export complete!', filename);
    setTimeout(() => {
      progress.close();
      modalManager.toast(`PNG exported: ${filename}`, 'success', 'Export Complete');
    }, 500);

    return { ok: true, filename, width, height, size: blob.size };
  } catch (error) {
    progress.close();
    await modalManager.alert(
      'Export failed: ' + error.message + '\n\nMake sure the preview is actively rendering.',
      'Export Error'
    );
    return { ok: false, error: error.message };
  }
}

/**
 * Record an animation at the export resolution and download it.
 *
 * @param {object} [options] fps, duration, quality, includeAudio,
 *   filenamePrefix - each defaulting to the panel's current setting.
 * @returns {Promise<{ok: boolean, filename?: string, error?: string}>}
 */
export async function exportAnimation(options = {}) {
  const settings = { ...getExportSettings(), ...options };
  const fps = Math.round(settings.fps);
  const duration = settings.duration;

  const preview = getPreview();
  const canvas = preview?.gpuCanvas;
  if (!canvas || typeof canvas.captureStream !== 'function') {
    await modalManager.alert('Canvas streaming is not supported in this browser.', 'Browser Compatibility');
    return { ok: false, error: 'no-capture-stream' };
  }
  if (typeof MediaRecorder === 'undefined') {
    await modalManager.alert('MediaRecorder API is not available. Try a Chromium-based browser.', 'Browser Compatibility');
    return { ok: false, error: 'no-media-recorder' };
  }

  const ready = await prepareRenderer('render');
  if (!ready) return { ok: false, error: 'renderer-not-ready' };

  const { renderer } = ready;
  const { width: targetWidth, height: targetHeight } = captureSize(canvas);

  const originalWidth = canvas.width;
  const originalHeight = canvas.height;
  const originalStyleWidth = canvas.style.width;
  const originalStyleHeight = canvas.style.height;

  // Tap the loaded audio, if the artist asked for it and there is one. The
  // local export carries the music for the same reason a published one does:
  // a recording of an audio-reactive patch that plays silent is a recording of
  // something dancing to nothing.
  let audioTap = null;
  if (settings.includeAudio && hasRecordableAudio(window.audioCapture)) {
    try {
      audioTap = await openAudioTap(window.audioCapture);
    } catch (err) {
      console.warn('Could not tap the audio graph, recording without sound:', err);
    }
    if (!audioTap) {
      modalManager.toast('Audio could not be captured — recording video only.', 'warning', 'Export');
    }
  }

  // The container has to be chosen knowing whether an audio track is coming: a
  // video-only mime type drops the track without a word.
  const mimeType = selectRecordingMimeType({ withAudio: !!audioTap });
  if (!mimeType) {
    audioTap?.stop();
    await modalManager.alert('No supported video encoder found for this browser.', 'Browser Compatibility');
    return { ok: false, error: 'no-encoder' };
  }
  if (!mimeType.includes('mp4')) {
    console.warn(`MP4/H.264 not available, using fallback: ${mimeType}.`);
  }

  const fileExt = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const audioBitrate = audioTap ? AUDIO_BITRATE : 0;

  // The same function the panel drew its estimate with, so the file that lands
  // is the size the artist was shown. No upload budget applies to a download,
  // so none is passed.
  const videoBitrate = resolveVideoBitrate({
    width: targetWidth,
    height: targetHeight,
    fps,
    quality: settings.quality,
    duration,
    audioBitrate,
  });

  let stopRequested = false;
  let recorder = null;
  const progress = modalManager.showProgress('Exporting Animation', 'Preparing export...', {
    actions: [
      {
        id: 'stop',
        label: 'Stop & Save',
        onClick: () => {
          stopRequested = true;
          if (recorder && recorder.state === 'recording') recorder.stop();
        },
      },
    ],
  });
  // Nothing to stop until the recorder is rolling.
  progress.setActionEnabled('stop', false);

  try {
    progress.update(5, 'Resizing canvas to export resolution...', `${targetWidth}x${targetHeight}`);

    if (renderer.resizeCanvasSync) {
      await renderer.resizeCanvasSync(targetWidth, targetHeight);
    } else {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    preview?.updateSize?.();

    progress.update(8, 'Initializing renderer...', '');

    renderFrame(renderer);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const estimatedBytes = ((videoBitrate + audioBitrate) * duration) / 8;
    progress.update(
      10,
      'Starting recording...',
      `${mimeType.split(';')[0]} @ ${fps} FPS · ${(videoBitrate / 1_000_000).toFixed(1)} Mbps` +
        `${audioTap ? ' + audio' : ''} · ~${formatFileSize(estimatedBytes)}`
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
          renderFrame(renderer);
        } catch (error) {
          console.warn('Render tick failed during animation export:', error);
        }
        lastRenderTime = currentTime;
      }

      renderRequestId = requestAnimationFrame(renderPump);
    };

    renderRequestId = requestAnimationFrame(renderPump);

    // Warm up a few frames before recording starts.
    for (let i = 0; i < 3; i++) {
      renderFrame(renderer);
      await new Promise((resolve) => setTimeout(resolve, frameIntervalMs));
    }

    const releaseRecording = () => {
      isRecording = false;
      if (renderRequestId) cancelAnimationFrame(renderRequestId);
      if (mainRenderLoop && typeof mainRenderLoop.start === 'function' && !wasPaused) {
        mainRenderLoop.start();
      }
      stream.getTracks().forEach((track) => track.stop());
      audioTap?.stop();
    };

    try {
      const recorderOptions = {
        mimeType: applyFrameRate(mimeType, fps),
        videoBitsPerSecond: videoBitrate,
      };
      if (audioTap) recorderOptions.audioBitsPerSecond = AUDIO_BITRATE;
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch (error) {
      releaseRecording();
      progress.close();
      await modalManager.alert('Unable to start recorder: ' + error.message, 'Recording Error');
      return { ok: false, error: error.message };
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
    progress.setActionEnabled('stop', true);

    const startTime = Date.now();
    const totalDurationMs = duration * 1000;

    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progressPercent = Math.min(90, 10 + (elapsed / totalDurationMs) * 80);
      const remaining = Math.max(0, duration - elapsed / 1000);
      const capturedBytes = chunks.reduce((sum, c) => sum + c.size, 0);

      progress.update(
        progressPercent,
        stopRequested ? 'Finishing up…' : `Recording... ${remaining.toFixed(1)}s remaining`,
        `${formatFileSize(capturedBytes)} captured`
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
      console.error('Animation export failed:', error);
      progress.close();
      await modalManager.alert('Animation export failed: ' + error.message, 'Export Error');
      return { ok: false, error: error.message };
    } finally {
      clearTimeout(stopTimer);
      progress.setActionEnabled('stop', false);
      releaseRecording();
    }

    if (!chunks.length) {
      progress.close();
      await modalManager.alert('Recording produced no data.', 'Export Error');
      return { ok: false, error: 'no-data' };
    }

    progress.update(90, 'Finalizing video...', 'Creating blob...');

    const blob = new Blob(chunks, { type: mimeType });
    const recordedSeconds = Math.min(duration, (Date.now() - startTime) / 1000);

    progress.update(95, 'Preparing download...', `File size: ${formatFileSize(blob.size)}`);

    const filename = downloadBlob(
      blob,
      buildExportFilename({
        prefix: settings.filenamePrefix,
        width: targetWidth,
        height: targetHeight,
        fps,
        extension: fileExt,
      }),
      1000
    );

    progress.update(100, 'Export complete!', filename);
    setTimeout(() => {
      progress.close();
      modalManager.toast(
        stopRequested
          ? `Animation exported (stopped at ${recordedSeconds.toFixed(1)}s): ${filename}`
          : `Animation exported: ${filename}`,
        'success',
        'Export Complete'
      );
    }, 500);

    return {
      ok: true,
      filename,
      width: targetWidth,
      height: targetHeight,
      fps,
      duration: recordedSeconds,
      size: blob.size,
      stoppedEarly: stopRequested,
    };
  } catch (error) {
    progress.close();
    audioTap?.stop();
    console.error('Animation export failed:', error);
    await modalManager.alert('Export failed: ' + error.message, 'Export Error');
    return { ok: false, error: error.message };
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
}

/** One frame, through the app's render entry point if it has one. */
function renderFrame(renderer) {
  if (typeof window.render === 'function') {
    window.render();
  } else if (renderer?.render) {
    renderer.render();
  }
}

/** Run whichever export the settings currently describe. */
export async function runExport(options = {}) {
  const settings = { ...getExportSettings(), ...options };
  return settings.format === 'png' ? exportPNG(settings) : exportAnimation(settings);
}
