/**
 * publish.js - Share renders to the TenderWorld gallery.
 *
 * Reached from File → Publish. Both entry points capture at the single render
 * resolution (see RenderResolution.js), upload the file and open the gallery's
 * publish page for the uploaded asset.
 */

import { modalManager } from './ModalManager.js';
import { getRenderResolution } from './RenderResolution.js';

const UPLOAD_ENDPOINT = 'https://art.tenderworld.org/api/rhizo-upload';
const GALLERY_ORIGIN = 'https://art.tenderworld.org';

function getPreview() {
  return window.floatingPreview || null;
}

function captureSize(canvas) {
  const resolution = getRenderResolution();
  return {
    width: Math.max(1, Math.floor(resolution.width || canvas?.width || 1)),
    height: Math.max(1, Math.floor(resolution.height || canvas?.height || 1)),
  };
}

/** Upload a blob with progress reporting. Resolves with the parsed response. */
function uploadBlob(blob, filename, onProgress) {
  const formData = new FormData();
  formData.append('file', blob, filename);

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
        reject(new Error(`File too large (${fileSizeMB.toFixed(2)} MB). Server limit exceeded. Try a lower render resolution.`));
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
  });

  xhr.open('POST', UPLOAD_ENDPOINT);
  xhr.withCredentials = true;
  xhr.send(formData);

  return uploadPromise;
}

function openPublishPage(url) {
  window.open(`${GALLERY_ORIGIN}/gallery/publish?url=${encodeURIComponent(url)}`, '_blank');
}

async function handleUploadError(err, sizeHint) {
  const message = err?.message || String(err);

  if (message.includes('401') || message.includes('Unauthorized')) {
    const shouldSignIn = await modalManager.confirm(
      'You need to sign in to share your work.\n\nWould you like to go to the gallery and sign in?',
      'Sign In Required'
    );
    if (shouldSignIn) window.open(GALLERY_ORIGIN, '_blank');
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
    progress.update(70, 'Preparing upload...', `File size: ${(blob.size / 1024).toFixed(2)} KB`);

    const data = await uploadBlob(blob, filename, (loaded, total) => {
      progress.update(
        70 + (loaded / total) * 25,
        'Uploading to gallery...',
        `${(loaded / 1024).toFixed(2)} KB / ${(total / 1024).toFixed(2)} KB`
      );
    });

    if (!data.url) throw new Error('No URL returned from upload');

    progress.update(100, 'Upload complete!', 'Opening publish page...');
    setTimeout(() => {
      progress.close();
      modalManager.toast('Image uploaded successfully! Opening publish page...', 'success', 'Share to Gallery');
      openPublishPage(data.url);
    }, 500);
  } catch (err) {
    progress.close();
    const fileSizeMB = (blob?.size || 0) / 1024 / 1024;
    await handleUploadError(
      err,
      `Size: ${fileSizeMB.toFixed(2)} MB at ${width}x${height}. Lower the render resolution in View → Preview / Export Settings.`
    );
  }
}

/** Record an animation at the render resolution and publish it to the gallery. */
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

  // Prefer MP4/H.264, fall back to WebM where it is unavailable.
  const mimeCandidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1.4D001E',
    'video/mp4;codecs=avc1.64001E',
    'video/mp4;codecs=h264',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mimeType = mimeCandidates.find((candidate) => {
    try {
      return MediaRecorder.isTypeSupported(candidate);
    } catch {
      return false;
    }
  });

  if (!mimeType) {
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
  const estimatedFileSizeMB = (estimatedBitrate * duration) / (8 * 1024 * 1024);
  const maxTargetSizeMB = 50;

  let adaptiveBitrate = estimatedBitrate;
  if (estimatedFileSizeMB > maxTargetSizeMB) {
    const scaleFactor = maxTargetSizeMB / estimatedFileSizeMB;
    adaptiveBitrate = Math.floor(estimatedBitrate * scaleFactor * 0.95);
  }
  adaptiveBitrate = Math.max(1_000_000, Math.min(50_000_000, adaptiveBitrate));

  const progress = modalManager.showProgress('Publishing Animation', 'Preparing export...');

  try {
    progress.update(5, 'Resizing canvas to render resolution...', `${targetWidth}x${targetHeight}`);

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

    const estimatedSizeMB = ((adaptiveBitrate * duration) / (8 * 1024 * 1024)).toFixed(1);
    progress.update(
      10,
      'Starting recording...',
      `Codec: ${mimeType.split(';')[0]} @ ${fps} FPS | Bitrate: ${(adaptiveBitrate / 1_000_000).toFixed(1)} Mbps | Est. size: ~${estimatedSizeMB} MB`
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
      const recorderOptions = { mimeType, videoBitsPerSecond: adaptiveBitrate };
      const baseMimeType = mimeType.split(';')[0];
      if (MediaRecorder.isTypeSupported(`${baseMimeType};framerate=${fps}`)) {
        recorderOptions.mimeType = `${baseMimeType};framerate=${fps}`;
      }
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

      const data = await uploadBlob(blob, filename, (loaded, total) => {
        progress.update(
          80 + (loaded / total) * 15,
          'Uploading to gallery...',
          `${(loaded / 1024 / 1024).toFixed(2)} MB / ${(total / 1024 / 1024).toFixed(2)} MB`
        );
      });

      if (!data.url) throw new Error('No URL returned from upload');

      progress.update(100, 'Upload complete!', 'Opening publish page...');
      setTimeout(() => {
        progress.close();
        modalManager.toast('Animation uploaded successfully! Opening publish page...', 'success', 'Share to Gallery');
        openPublishPage(data.url);
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
  }
}
