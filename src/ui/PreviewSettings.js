/**
 * PreviewSettings.js - Settings panel with Share to Gallery2
 */

import { makeDraggable } from './utils/draggable.js';
import { modalManager } from './ModalManager.js';

export class PreviewSettings {
  constructor(floatingPreview) {
    this.floatingPreview = floatingPreview;
    // Initialize settings - this object is shared with PreviewExportSettingsWindow
    this.settings = {
      resolution: { width: 512, height: 512 },
      refreshRate: 60,
      timingMode: "vsync",
      wireframe: false,
      showNormals: false,
      debugChannel: "none",
      timeScale: 1.0,
      isPaused: false,
      quality: "high",
      showFPS: false,
      adaptiveQuality: {
        enabled: true,
        interactionScale: 0.7,
        resolutionScale: 0.75,
        cooldownMs: 350,
      },
    };
    // Ensure resolution object exists
    if (!this.settings.resolution) {
      this.settings.resolution = { width: 512, height: 512 };
    }
    this.settingsPanel = null;
    this._refreshRateControls = null;
    this.cleanupDraggable = null;
  }

  async _publishImage() {
    const canvas = this.floatingPreview.gpuCanvas;
    if (!canvas) {
      await modalManager.alert('Canvas not available. Open preview first.', 'Error');
      return;
    }

    if (typeof window.initWebGPU === 'function' && !window._gpuDevice) {
      try { 
        await window.initWebGPU(canvas, true); 
      } catch (_) {}
    }

    const renderer = window.gpuRenderer;
    if (!renderer || typeof renderer.captureFrame !== 'function') {
      await modalManager.alert('Renderer not ready. Render preview at least once.', 'Error');
      return;
    }

    const resolution = this.settings.resolution || { width: canvas.width, height: canvas.height };
    const width = Math.max(1, Math.floor(resolution.width || canvas.width || 1));
    const height = Math.max(1, Math.floor(resolution.height || canvas.height || 1));

    try {
      // Capture frame
      const capture = await renderer.captureFrame({ width, height });
      const { pixels, bytesPerRow } = capture;

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
    imageData.data[di + 0] = pixels[si + 2]; // R from B
    imageData.data[di + 1] = pixels[si + 1]; // G stays
    imageData.data[di + 2] = pixels[si + 0]; // B from R
    imageData.data[di + 3] = pixels[si + 3]; // A stays
  }
}
      ctx.putImageData(imageData, 0, 0);

      const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/webp', 0.95));
      if (!blob) {
        await modalManager.alert('Failed to create image blob', 'Error');
        return;
      }

      // Upload to gallery
      const timestamp = Date.now();
      const filename = `shader-${timestamp}.webp`;
      
      const formData = new FormData();
      formData.append('file', blob, filename);

      const response = await fetch('https://art.tenderworld.org/api/rhizo-upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || `Upload failed (${response.status})`);
      }

      const data = await response.json();
      
      if (!data.url) {
        throw new Error('No URL returned from upload');
      }

      // Show success message and open publish page
      modalManager.toast('Image uploaded successfully! Opening publish page...', 'success', 'Share to Gallery');
      setTimeout(() => {
        window.open(`https://art.tenderworld.org/gallery/publish?url=${encodeURIComponent(data.url)}`, '_blank');
      }, 1000);

    } catch (err) {

      if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        const shouldSignIn = await modalManager.confirm(
          'You need to sign in to share your work.\n\nWould you like to go to the gallery and sign in?',
          'Sign In Required'
        );
        if (shouldSignIn) {
          window.open('https://art.tenderworld.org', '_blank');
        }
      } else {
        await modalManager.alert(`Publish failed: ${err?.message || err}`, 'Upload Error');
      }
    }
  }
async _publishAnimation() {
  const canvas = this.floatingPreview.gpuCanvas;
  if (!canvas || typeof canvas.captureStream !== 'function') {
    await modalManager.alert("Canvas streaming is not supported in this browser.", 'Browser Compatibility');
    return;
  }
  if (typeof MediaRecorder === 'undefined') {
    await modalManager.alert("MediaRecorder API is not available. Try a Chromium-based browser.", 'Browser Compatibility');
    return;
  }

  if (typeof window.initWebGPU === 'function' && !window._gpuDevice) {
    try {
      await window.initWebGPU(canvas, true);
    } catch (error) {

    }
  }

  const renderer = window.gpuRenderer;
  if (!renderer || typeof renderer.render !== 'function') {
    await modalManager.alert("GPU renderer not ready. Render the preview before exporting animation.", 'Error');
    return;
  }

  const defaultFps = Math.max(1, this.settings.refreshRate || 30);
  const fpsInput = await modalManager.prompt("Frames per second for the recording (1-60)?", 'Animation Settings', String(defaultFps), {
    inputType: 'number',
    placeholder: '30',
    validator: (value) => {
      const fps = Number(value);
      if (!Number.isFinite(fps) || fps <= 0 || fps > 60) {
        return 'Please enter a valid FPS value between 1 and 60';
      }
      return null;
    }
  });
  if (fpsInput === null) return;

  const fps = Math.min(60, Math.max(1, Number(fpsInput)));

  const durationInput = await modalManager.prompt("Duration in seconds (1-60)?", 'Animation Settings', "5", {
    inputType: 'number',
    placeholder: '5',
    validator: (value) => {
      const duration = Number(value);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
        return 'Please enter a valid duration between 1 and 60 seconds';
      }
      return null;
    }
  });
  if (durationInput === null) return;

  const duration = Math.min(60, Math.max(1, Number(durationInput)));

  const mimeCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mimeType = mimeCandidates.find((candidate) => {
    try {
      return MediaRecorder.isTypeSupported(candidate);
    } catch {
      return false;
    }
  });

  if (!mimeType) {
    await modalManager.alert("No supported WebM encoder found for this browser.", 'Browser Compatibility');
    return;
  }

  this.floatingPreview.updateSize();
  if (typeof window.render === "function") {
    window.render();
  } else {
    renderer.render();
  }

  const stream = canvas.captureStream(fps);
  const chunks = [];

  let renderInterval = null;
  if (typeof renderer.render === "function" || typeof window.render === "function") {
    const frameInterval = Math.max(1, Math.floor(1000 / fps));
    renderInterval = setInterval(() => {
      try {
        if (typeof window.render === "function") {
          window.render();
        } else {
          renderer.render();
        }
      } catch (error) {

      }
    }, frameInterval);
  }

  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });
  } catch (error) {
    if (renderInterval) {
      clearInterval(renderInterval);
    }
    stream.getTracks().forEach((track) => track.stop());
    await modalManager.alert("Unable to start recorder: " + error.message, 'Recording Error');
    return;
  }

  const recordingPromise = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = (event) => {
      reject(event.error || new Error("Recording error"));
    };
    recorder.onstop = () => resolve();
  });

  recorder.start();

  const stopTimer = setTimeout(() => {
    if (recorder.state === "recording") {
      recorder.stop();
    }
  }, duration * 1000);

  try {
    await recordingPromise;
  } catch (error) {

    await modalManager.alert("Animation recording failed: " + error.message, 'Recording Error');
    return;
  } finally {
    clearTimeout(stopTimer);
    if (renderInterval) {
      clearInterval(renderInterval);
    }
    stream.getTracks().forEach((track) => track.stop());
  }

  if (!chunks.length) {
    await modalManager.alert("Recording produced no data.", 'Recording Error');
    return;
  }

  // Create blob and upload
  const blob = new Blob(chunks, { type: mimeType });
  const timestamp = Date.now();
  const filename = `shader-${timestamp}.webm`;

  try {
    const formData = new FormData();
    formData.append('file', blob, filename);

    modalManager.toast('Uploading animation...', 'info', 'Share to Gallery');

    const response = await fetch('https://art.tenderworld.org/api/rhizo-upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error || `Upload failed (${response.status})`);
    }

    const data = await response.json();

    if (!data.url) {
      throw new Error('No URL returned from upload');
    }

    // Show success message and open publish page
    modalManager.toast('Animation uploaded successfully! Opening publish page...', 'success', 'Share to Gallery');
    setTimeout(() => {
      window.open(`https://art.tenderworld.org/gallery/publish?url=${encodeURIComponent(data.url)}`, '_blank');
    }, 1000);

  } catch (err) {

    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
      const shouldSignIn = await modalManager.confirm(
        'You need to sign in to share your work.\n\nWould you like to go to the gallery and sign in?',
        'Sign In Required'
      );
      if (shouldSignIn) {
        window.open('https://art.tenderworld.org', '_blank');
      }
    } else {
      await modalManager.alert(`Upload failed: ${err?.message || err}`, 'Upload Error');
    }
  }
}

  // Rest of your existing methods stay the same...
  
  showSettings() {
    if (this.settingsPanel) {
      this.hideSettings();
      return;
    }

    this.settingsPanel = this._createSettingsPanel();
    document.body.appendChild(this.settingsPanel);
    this._positionSettingsPanel();

    requestAnimationFrame(() => {
      this.settingsPanel.style.opacity = "1";
      this.settingsPanel.style.transform = "scale(1)";
      
      // Refresh UI with current settings in case they changed externally
      this._refreshPanelUI();
    });
  }

  _refreshPanelUI() {
    // Refresh UI elements when settings change externally from PreviewExportSettingsWindow
    if (!this.settingsPanel) return;
    
    // Update resolution inputs
    const resolutionInputs = this.settingsPanel.querySelectorAll('.resolution-input input');
    resolutionInputs.forEach(input => {
      if (input.placeholder?.toLowerCase().includes('width')) {
        if (input.value !== String(this.settings.resolution?.width || 512)) {
          input.value = this.settings.resolution?.width || 512;
        }
      } else if (input.placeholder?.toLowerCase().includes('height')) {
        if (input.value !== String(this.settings.resolution?.height || 512)) {
          input.value = this.settings.resolution?.height || 512;
        }
      }
    });
    
    // Update quality dropdown
    const qualitySelect = this.settingsPanel.querySelector('select');
    if (qualitySelect && qualitySelect.options.length > 0) {
      const qualityOptions = Array.from(qualitySelect.options).map(opt => opt.value);
      if (qualityOptions.includes(this.settings.quality) && qualitySelect.value !== this.settings.quality) {
        qualitySelect.value = this.settings.quality;
      }
    }
    
    // Update wireframe checkbox if it exists
    const wireframeCheckbox = this.settingsPanel.querySelector('input[type="checkbox"]');
    if (wireframeCheckbox) {
      const label = wireframeCheckbox.closest('label');
      if (label && label.textContent.toLowerCase().includes('wireframe')) {
        if (wireframeCheckbox.checked !== !!this.settings.wireframe) {
          wireframeCheckbox.checked = !!this.settings.wireframe;
        }
      }
    }
  }

  hideSettings() {
    if (!this.settingsPanel) return;

    // Cleanup draggable
    if (this.cleanupDraggable) {
      this.cleanupDraggable();
      this.cleanupDraggable = null;
    }

    this.settingsPanel.style.opacity = "0";
    this.settingsPanel.style.transform = "scale(0.95)";

    setTimeout(() => {
      if (this.settingsPanel) {
        this.settingsPanel.remove();
        this.settingsPanel = null;
      }
    }, 200);
  }

  _positionSettingsPanel() {
    if (!this.settingsPanel || !this.floatingPreview.container) return;

    const previewRect = this.floatingPreview.container.getBoundingClientRect();
    const panelWidth = 280;
    const panelHeight = this.settingsPanel.offsetHeight || 500;

    let left = previewRect.right + 10;
    let top = previewRect.top;

    if (left + panelWidth > window.innerWidth) {
      left = previewRect.left - panelWidth - 10;
    }
    if (top + panelHeight > window.innerHeight) {
      top = window.innerHeight - panelHeight - 10;
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    this.settingsPanel.style.left = left + "px";
    this.settingsPanel.style.top = top + "px";
  }

  updateSetting(key, value) {
    if (key.includes(".")) {
      const [parent, child] = key.split(".");
      if (!this.settings[parent]) this.settings[parent] = {};
      this.settings[parent][child] = value;
    } else {
      this.settings[key] = value;
    }

    this._applySetting(key, value);
    
    // Notify PreviewExportSettingsWindow if it exists and is open
    if (window.previewExportSettingsWindow && window.previewExportSettingsWindow.window && 
        window.previewExportSettingsWindow.window.style.display !== 'none') {
      window.previewExportSettingsWindow._syncUIElement(key, value);
    }
    
    // Refresh this panel's UI if it's open
    if (this.settingsPanel && this.settingsPanel.style.display !== 'none') {
      this._refreshPanelUIElement(key, value);
    }
  }

  _refreshPanelUIElement(key, value) {
    // Update UI elements in this panel when settings change externally
    if (!this.settingsPanel) return;
    
    // Try to find by data attribute first (most reliable)
    const elementByDataAttr = this.settingsPanel.querySelector(`[data-setting-key="${key}"]`);
    if (elementByDataAttr) {
      if (elementByDataAttr.type === 'checkbox') {
        if (elementByDataAttr.checked !== !!value) {
          elementByDataAttr.checked = !!value;
          // Don't dispatch event to avoid infinite loop - just update visually
        }
      } else if (elementByDataAttr.type === 'number') {
        if (elementByDataAttr.value !== String(value)) {
          elementByDataAttr.value = value;
        }
      } else if (elementByDataAttr.tagName === 'SELECT') {
        const options = Array.from(elementByDataAttr.options).map(opt => opt.value);
        if (options.includes(value) && elementByDataAttr.value !== value) {
          elementByDataAttr.value = value;
        }
      } else if (elementByDataAttr.type === 'range') {
        if (elementByDataAttr.value !== String(value)) {
          elementByDataAttr.value = value;
        }
        const unit = elementByDataAttr.dataset.displayUnit || '';
        const valueDisplay =
          this.settingsPanel.querySelector(`[data-slider-value-for="${key}"]`) ||
          elementByDataAttr.parentElement?.querySelector('.slider-value');
        if (valueDisplay) {
          const numericValue = Number(value);
          let formatted = value;
          if (Number.isFinite(numericValue)) {
            const precision = unit === 'ms' ? 0 : 2;
            formatted = numericValue.toFixed(precision);
            formatted = formatted.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
          }
          valueDisplay.textContent = `${formatted}${unit}`;
        }
      }
      return; // Found by data attribute, done
    }
    
    // Fallback to finding by label text for compatibility
    // Update resolution inputs
    if (key === 'resolution.width' || key === 'resolution.height') {
      const [, prop] = key.split('.');
      const inputs = this.settingsPanel.querySelectorAll('.resolution-input input, input[type="number"]');
      inputs.forEach(input => {
        const placeholder = (input.placeholder || '').toLowerCase();
        const container = input.closest('.resolution-input');
        const label = container?.querySelector('label');
        const labelText = label ? label.textContent.toLowerCase() : '';
        
        const isWidth = prop === 'width' && (
          placeholder.includes('width') || 
          labelText.includes('width') ||
          (inputs[0] === input && !placeholder.includes('height'))
        );
        const isHeight = prop === 'height' && (
          placeholder.includes('height') || 
          labelText.includes('height') ||
          (inputs[1] === input && !placeholder.includes('width'))
        );
        
        if ((isWidth || isHeight) && input.value !== String(value)) {
          input.value = value;
        }
      });
    }
    
    // Update quality dropdown
    if (key === 'quality') {
      const selects = this.settingsPanel.querySelectorAll('select');
      selects.forEach(select => {
        const options = Array.from(select.options).map(opt => opt.value);
        if (options.includes('low') && options.includes('medium') && options.includes('high')) {
          if (options.includes(value) && select.value !== value) {
            select.value = value;
          }
        }
      });
    }
    
    // Update wireframe checkbox
    if (key === 'wireframe') {
      const checkboxes = this.settingsPanel.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => {
        const label = cb.closest('label') || cb.parentElement;
        const labelText = label ? label.textContent.toLowerCase() : '';
        if (labelText.includes('wireframe')) {
          if (cb.checked !== !!value) {
            cb.checked = !!value;
          }
        }
      });
    }
    
    // Update refresh rate slider value display
    if (key === 'refreshRate' && this._refreshRateControls) {
      const { slider, valueEl } = this._refreshRateControls;
      if (slider && slider.value !== String(value)) {
        slider.value = value;
        if (valueEl) {
          valueEl.textContent = `${value}Hz`;
        }
      }
    }
    
    // Update showFPS checkbox
    if (key === 'showFPS') {
      const checkboxes = this.settingsPanel.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => {
        const label = cb.closest('label') || cb.parentElement;
        const labelText = label ? label.textContent.toLowerCase() : '';
        if (labelText.includes('fps')) {
          if (cb.checked !== !!value) {
            cb.checked = !!value;
          }
        }
      });
    }
  }

  _applySetting(key, value) {
    switch (key) {
      case "resolution.width":
      case "resolution.height":
        this._updateResolution();
        break;
      case "showFPS":
        this._updateFPSDisplay(value);
        break;
      case "debugChannel":
        this._updateDebugChannel(value);
        break;
      case "quality":
        this._updateQuality(value);
        break;
      case "refreshRate":
        this._updateRefreshRate(value);
        break;
      case "timingMode":
        this._updateTimingMode(value);
        break;
      case "timeScale":
        this._updateTimeScale(value);
        break;
      case "isPaused":
        this._updatePauseState(value);
        break;
      case "adaptiveQuality.enabled":
      case "adaptiveQuality.interactionScale":
      case "adaptiveQuality.resolutionScale":
      case "adaptiveQuality.cooldownMs":
        this._updateAdaptiveQuality();
        break;
    }
  }

  _updateFPSDisplay(show) {
    const fpsOverlay = document.querySelector(".fps-overlay");
    if (fpsOverlay) {
      fpsOverlay.style.display = show ? "block" : "none";
    }

    if (show && this.floatingPreview.fpsCounter) {
      this.floatingPreview.fpsCounter.start();
    } else if (this.floatingPreview.fpsCounter) {
      this.floatingPreview.fpsCounter.stop();
    }
  }

  _updateDebugChannel(channel) {
    const debugOverlay = document.querySelector(".debug-overlay");
    if (debugOverlay) {
      if (channel === "none") {
        debugOverlay.style.display = "none";
      } else {
        debugOverlay.style.display = "block";
        debugOverlay.textContent = `DEBUG: ${channel.toUpperCase()}`;
        
        const colors = {
          red: "rgba(255, 0, 0, 0.8)",
          green: "rgba(0, 255, 0, 0.8)",
          blue: "rgba(0, 128, 255, 0.8)",
          alpha: "rgba(128, 128, 128, 0.8)"
        };
        debugOverlay.style.background = colors[channel] || "rgba(255, 0, 0, 0.8)";
      }
    }
    
    window.debugChannel = channel;
    
    if (this.floatingPreview.isVisible && window.rebuild) {
      window.rebuild();
    }
  }

  async _updateResolution() {
    const { width, height } = this.settings.resolution;

    if (!this.floatingPreview.gpuCanvas) return;
    
    // Stop render loop temporarily to prevent using destroyed textures
    if (window.renderLoop && window.renderLoop.stop) {
      window.renderLoop.stop();
    }
    
    // Wait for current GPU operations to complete before resizing
    const gpuRenderer = window.gpuRenderer;
    if (gpuRenderer && gpuRenderer.device) {
      try {
        await gpuRenderer.device.queue.onSubmittedWorkDone();
        // Wait a bit more to ensure textures are fully released
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        console.warn('[PreviewSettings] Failed to wait for GPU sync:', err);
      }
    }

    // Let floatingPreview.updateSize() handle the resize using resizeCanvasSync
    // This ensures proper texture recreation and prevents "destroyed texture" errors
    await this.floatingPreview.updateSize();
    
    // Restart render loop after resize completes
    setTimeout(() => {
      if (window.renderLoop && window.renderLoop.start) {
        window.renderLoop.start();
      } else if (typeof window.render === "function") {
        window.render();
      }
    }, 100);
  }

  _updateQuality(quality) {
    const canvas = this.floatingPreview.gpuCanvas;
    if (!canvas) return;
    
    const pixelRatio = {
      'low': 0.5,
      'medium': 1,
      'high': window.devicePixelRatio || 2
    }[quality] || 1;
    
    const { width, height } = this.settings.resolution;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    
    if (window.rebuild) {
      window.rebuild();
    }
  }

  _updateRefreshRate(fps) {
    const clamped = Math.max(1, Math.min(120, fps));
    this.settings.refreshRate = clamped;

    if (this.floatingPreview.animationLoop) {
      clearInterval(this.floatingPreview.animationLoop);
      this.floatingPreview.animationLoop = null;
    }

    if (window.renderLoop) {
      window.renderLoop.setFixedFps(clamped);
      if (this.settings.timingMode === "fixed") {
        window.renderLoop.renderNow({ advance: false });
      }
    }
  }

  _updateTimingMode(mode) {
    const normalized = mode === "fixed" ? "fixed" : "vsync";
    this.settings.timingMode = normalized;
    this._syncRefreshRateAvailability();

    if (window.renderLoop) {
      window.renderLoop.setMode(normalized);
      if (normalized === "fixed") {
        window.renderLoop.setFixedFps(this.settings.refreshRate);
      }
      window.renderLoop.renderNow({ advance: false });
    }
  }

  _syncRefreshRateAvailability() {
    if (!this._refreshRateControls) return;

    const disabled = this.settings.timingMode !== "fixed";
    const { slider, valueEl, label, container } = this._refreshRateControls;

    slider.disabled = disabled;
    slider.style.opacity = disabled ? "0.35" : "1";
    slider.style.pointerEvents = disabled ? "none" : "auto";
    valueEl.style.opacity = disabled ? "0.6" : "1";
    if (label) {
      label.style.opacity = disabled ? "0.6" : "1";
    }
    if (container) {
      container.style.opacity = disabled ? "0.75" : "1";
    }
  }

  _updateTimeScale(scale) {
    window.timeScale = scale;
    
    if (window.expressionSystem) {
      window.expressionSystem.timeScale = scale;
    }
    if (window.editor) {
      window.editor.timeScale = scale;
    }

    if (window.renderLoop) {
      window.renderLoop.setTimeScale(scale);
      window.renderLoop.renderNow({ advance: false });
    }
    
    if (this.floatingPreview.isVisible && window.rebuild) {
      window.rebuild();
    }
  }

  _updatePauseState(paused) {
    if (paused) {
      this._pausedTimeScale = window.timeScale || this.settings.timeScale;
      window.timeScale = 0;
      
      if (window.expressionSystem) {
        window.expressionSystem.timeScale = 0;
      }
      if (window.editor) {
        window.editor.timeScale = 0;
      }
    } else {
      const restoredScale = this._pausedTimeScale || this.settings.timeScale;
      window.timeScale = restoredScale;
      
      if (window.expressionSystem) {
        window.expressionSystem.timeScale = restoredScale;
      }
      if (window.editor) {
        window.editor.timeScale = restoredScale;
      }
    }
    
    if (window.renderLoop) {
      window.renderLoop.setPaused(paused);
      window.renderLoop.renderNow({ advance: false });
    }
    
    if (this.floatingPreview.isVisible && window.rebuild) {
      window.rebuild();
    }
  }

  _updateAdaptiveQuality() {
    if (this.floatingPreview && typeof this.floatingPreview.onAdaptiveSettingsChanged === "function") {
      this.floatingPreview.onAdaptiveSettingsChanged(this.settings.adaptiveQuality);
    }
  }

  _createSettingsPanel() {
    const panel = document.createElement("div");
    panel.className = "preview-settings-panel custom-scroll";
    panel.style.cssText = `
      position: fixed;
      width: 280px;
      background: rgba(28, 28, 30, 0.95);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 1001;
      overflow: hidden;
      opacity: 0;
      transform: scale(0.95);
      transition: all 0.2s ease;
      max-height: 500px;
      overflow-y: auto;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.05);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 1;
    `;

    const title = document.createElement("div");
    title.textContent = "Preview Settings";
    title.style.cssText = "color: #fff; font-size: 14px; font-weight: 600;";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
      background: transparent;
      border: none;
      color: #fff;
      cursor: pointer;
      font-size: 18px;
      padding: 4px;
      border-radius: 4px;
    `;
    closeBtn.onclick = () => this.hideSettings();

    header.appendChild(title);
    header.appendChild(closeBtn);

    const content = document.createElement("div");
    content.style.cssText = "padding: 16px;";

    content.appendChild(
      this._createSection("Resolution", [
        this._createResolutionControl(),
        this._createDropdown(
          "Quality",
          "quality",
          ["low", "medium", "high"],
          this.settings.quality,
        ),
      ]),
    );

    content.appendChild(
      this._createSection("Display", [
        this._createDropdown(
          "Timing Mode",
          "timingMode",
          ["vsync", "fixed"],
          this.settings.timingMode,
        ),
        this._createSlider(
          "Refresh Rate",
          "refreshRate",
          30,
          120,
          this.settings.refreshRate,
          "Hz",
        ),
        this._createCheckbox("Show FPS", "showFPS", this.settings.showFPS),
        this._createDropdown(
          "Debug Channel",
          "debugChannel",
          ["none", "red", "green", "blue", "alpha"],
          this.settings.debugChannel,
        ),
      ]),
    );

    content.appendChild(
      this._createSection("Adaptive Quality", this._createAdaptiveQualityControls()),
    );

    content.appendChild(
      this._createSection("Animation", [
        this._createSlider(
          "Time Scale",
          "timeScale",
          0,
          2,
          this.settings.timeScale,
          "x",
          0.01,
        ),
        this._createCheckbox("Pause Time", "isPaused", this.settings.isPaused),
      ]),
    );

    content.appendChild(
      this._createSection("Export", [
        this._createExportButtons(),
      ]),
    );

    panel.appendChild(header);
    panel.appendChild(content);

    // Make panel draggable by its header
    this.cleanupDraggable = makeDraggable(panel, header);

    return panel;
  }

  _createSection(title, controls) {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = title;
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;

    section.appendChild(sectionTitle);
    controls.forEach((control) => section.appendChild(control));

    return section;
  }

  _createAdaptiveQualityControls() {
    const config = this.settings.adaptiveQuality || {};
    return [
      this._createCheckbox(
        "Enable adaptive scaling",
        "adaptiveQuality.enabled",
        config.enabled !== false,
      ),
      this._createSlider(
        "Interaction size",
        "adaptiveQuality.interactionScale",
        0.3,
        1,
        config.interactionScale ?? 0.7,
        "x",
        0.05,
      ),
      this._createSlider(
        "Resolution scale",
        "adaptiveQuality.resolutionScale",
        0.25,
        1,
        config.resolutionScale ?? 0.75,
        "x",
        0.05,
      ),
      this._createSlider(
        "Recovery delay",
        "adaptiveQuality.cooldownMs",
        100,
        1000,
        config.cooldownMs ?? 350,
        "ms",
        50,
      ),
    ];
  }

  _createResolutionControl() {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 8px;";

    const inputContainer = document.createElement("div");
    inputContainer.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px;";

    const widthInput = this._createNumberInput(
      "Width",
      this.settings.resolution.width,
      128,
      4096,
    );
    const heightInput = this._createNumberInput(
      "Height",
      this.settings.resolution.height,
      128,
      4096,
    );

    const widthInputElement = widthInput.querySelector("input");
    const heightInputElement = heightInput.querySelector("input");
    
    // Store data attributes for synchronization
    if (widthInputElement) widthInputElement.setAttribute('data-setting-key', 'resolution.width');
    if (heightInputElement) heightInputElement.setAttribute('data-setting-key', 'resolution.height');
    
    if (widthInputElement) {
      widthInputElement.addEventListener("change", (e) => {
        const value = parseInt(e.target.value) || 512;
        // Update settings object directly first (they're shared with PreviewExportSettingsWindow)
        if (!this.settings.resolution) this.settings.resolution = {};
        this.settings.resolution.width = value;
        // Then call updateSetting to apply and notify other panels
        this.updateSetting("resolution.width", value);
      });
    }

    if (heightInputElement) {
      heightInputElement.addEventListener("change", (e) => {
        const value = parseInt(e.target.value) || 512;
        // Update settings object directly first (they're shared with PreviewExportSettingsWindow)
        if (!this.settings.resolution) this.settings.resolution = {};
        this.settings.resolution.height = value;
        // Then call updateSetting to apply and notify other panels
        this.updateSetting("resolution.height", value);
      });
    }

    const presets = document.createElement("div");
    presets.style.cssText = "display: flex; gap: 4px; flex-wrap: wrap;";

    const presetSizes = [
      { label: "256²", w: 256, h: 256 },
      { label: "512²", w: 512, h: 512 },
      { label: "1K²", w: 1024, h: 1024 },
      { label: "2K²", w: 2048, h: 2048 },
      { label: "HD", w: 1280, h: 720 },
      { label: "FHD", w: 1920, h: 1080 },
      { label: "4K", w: 3840, h: 2160 },
    ];

    presetSizes.forEach((preset) => {
      const btn = document.createElement("button");
      btn.textContent = preset.label;
      btn.style.cssText = `
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        cursor: pointer;
        transition: background 0.15s ease;
      `;

      btn.onmouseenter = () => (btn.style.background = "rgba(255, 255, 255, 0.2)");
      btn.onmouseleave = () => (btn.style.background = "rgba(255, 255, 255, 0.1)");

      btn.onclick = () => {
        this.updateSetting("resolution.width", preset.w);
        this.updateSetting("resolution.height", preset.h);
        widthInput.querySelector("input").value = preset.w;
        heightInput.querySelector("input").value = preset.h;
      };

      presets.appendChild(btn);
    });

    inputContainer.appendChild(widthInput);
    inputContainer.appendChild(heightInput);
    container.appendChild(inputContainer);
    container.appendChild(presets);

    return container;
  }

  _createNumberInput(label, value, min, max) {
    const container = document.createElement("div");
    container.style.cssText = "flex: 1;";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 11px;
      margin-bottom: 4px;
    `;

    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.style.cssText = `
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      box-sizing: border-box;
    `;

    container.appendChild(labelEl);
    container.appendChild(input);

    return container;
  }

  _createSlider(label, key, min, max, value, unit = "", step = 1) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 12px;";

    const header = document.createElement("div");
    header.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 6px;";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.style.cssText = "color: rgba(255, 255, 255, 0.8); font-size: 12px;";

    const valueEl = document.createElement("span");
    valueEl.textContent = `${value}${unit}`;
    valueEl.classList.add("slider-value");
    valueEl.setAttribute("data-slider-value-for", key);
    valueEl.style.cssText = "color: #fff; font-size: 12px; font-weight: 500;";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    slider.setAttribute("data-setting-key", key);
    slider.dataset.displayUnit = unit;
    slider.style.cssText = `
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      outline: none;
      border-radius: 2px;
      appearance: none;
      cursor: pointer;
    `;

    const style = document.createElement("style");
    style.textContent = `
      input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        width: 16px;
        height: 16px;
        background: #007AFF;
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid #fff;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }
      input[type="range"]::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: #007AFF;
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid #fff;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }
    `;
    if (!document.querySelector("#slider-styles")) {
      style.id = "slider-styles";
      document.head.appendChild(style);
    }

    slider.addEventListener("input", (e) => {
      const newValue = parseFloat(e.target.value);
      valueEl.textContent = `${newValue}${unit}`;
      this.updateSetting(key, newValue);
    });

    header.appendChild(labelEl);
    header.appendChild(valueEl);
    container.appendChild(header);
    container.appendChild(slider);

    if (key === "refreshRate") {
      this._refreshRateControls = {
        container,
        slider,
        valueEl,
        label: labelEl,
      };
      this._syncRefreshRateAvailability();
    }

    return container;
  }

  _createCheckbox(label, key, checked) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 12px; display: flex; align-items: center; gap: 8px;";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.setAttribute("data-setting-key", key);
    checkbox.style.cssText = `
      width: 16px;
      height: 16px;
      accent-color: #007AFF;
      cursor: pointer;
    `;

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.style.cssText = `
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      cursor: pointer;
      user-select: none;
    `;

    checkbox.addEventListener("change", (e) => {
      this.updateSetting(key, e.target.checked);
    });

    labelEl.addEventListener("click", () => {
      checkbox.checked = !checkbox.checked;
      this.updateSetting(key, checkbox.checked);
    });

    container.appendChild(checkbox);
    container.appendChild(labelEl);

    return container;
  }

  _formatDropdownLabel(option) {
    if (typeof option !== "string" || option.length === 0) {
      return "";
    }

    const normalized = option.toLowerCase();
    if (normalized === "vsync") return "V-Sync";
    if (normalized === "fixed") return "Fixed Step";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  _createDropdown(label, key, options, selected) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 12px;";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const select = document.createElement("select");
    select.style.cssText = `
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='white' viewBox='0 0 16 16'%3e%3cpath d='m7.247 4.86-4.796 5.481c-.566.647-.106 1.659.753 1.659h9.592a1 1 0 0 0 .753-1.659l-4.796-5.48a1 1 0 0 0-1.506 0z'/%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 8px center;
      background-size: 12px;
      padding-right: 32px;
    `;
    select.setAttribute("data-setting-key", key);

    options.forEach((option) => {
      const optionEl = document.createElement("option");
      optionEl.value = option;
      optionEl.textContent = this._formatDropdownLabel(option);
      optionEl.selected = option === selected;
      optionEl.style.cssText = "background: #1c1c1e; color: #fff;";
      select.appendChild(optionEl);
    });

    select.addEventListener("change", (e) => {
      this.updateSetting(key, e.target.value);
    });

    container.appendChild(labelEl);
    container.appendChild(select);

    return container;
  }

_createExportButtons() {
  const container = document.createElement("div");
  container.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

  // Share buttons
  const shareImage = this._createPrimaryButton("🎨 Share Image", () => this._publishImage());
  const shareAnim = this._createPrimaryButton("🎬 Share Animation", () => this._publishAnimation());
  
  // Divider
  const divider = document.createElement("div");
  divider.style.cssText = "height: 1px; background: rgba(255, 255, 255, 0.1); margin: 4px 0;";

  // Local export
  const exportPNG = this._createButton("Export as PNG", () => this._exportPNG());
  const exportAnim = this._createButton("Export Animation (WebM)", () => this._exportAnimation());

  container.appendChild(shareImage);
  container.appendChild(shareAnim);
  container.appendChild(divider);
  container.appendChild(exportPNG);
  container.appendChild(exportAnim);

  return container;
}

  _createPrimaryButton(label, onClick) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = `
      width: 100%;
      background: rgba(0, 122, 255, 1);
      border: 1px solid rgba(0, 122, 255, 1);
      color: #fff;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    `;

    button.onmouseenter = () => {
      button.style.background = "rgba(0, 150, 255, 1)";
      button.style.transform = "translateY(-1px)";
    };
    button.onmouseleave = () => {
      button.style.background = "rgba(0, 122, 255, 1)";
      button.style.transform = "translateY(0)";
    };
    button.onmousedown = () => {
      button.style.transform = "translateY(0)";
    };

    button.onclick = onClick;

    return button;
  }

  _createButton(label, onClick) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = `
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    `;

    button.onmouseenter = () => {
      button.style.background = "rgba(255, 255, 255, 0.15)";
      button.style.transform = "translateY(-1px)";
    };
    button.onmouseleave = () => {
      button.style.background = "rgba(255, 255, 255, 0.1)";
      button.style.transform = "translateY(0)";
    };
    button.onmousedown = () => {
      button.style.transform = "translateY(0)";
    };

    button.onclick = onClick;

    return button;
  }

  async _exportPNG() {
    const canvas = this.floatingPreview.gpuCanvas;
    if (!canvas) {
      await modalManager.alert("Canvas not available. Make sure the preview window is open.", 'Error');
      return;
    }

    if (typeof window.initWebGPU === "function" && !window._gpuDevice) {
      try {
        await window.initWebGPU(canvas, true);
      } catch (error) {

      }
    }

    const renderer = window.gpuRenderer;
    if (!renderer || typeof renderer.captureFrame !== "function") {
      await modalManager.alert("GPU renderer not ready for capture. Render the preview at least once before exporting.", 'Error');
      return;
    }

    const resolution = this.settings.resolution || { width: canvas.width, height: canvas.height };
    const width = Math.max(1, Math.floor(resolution.width || canvas.width || 1));
    const height = Math.max(1, Math.floor(resolution.height || canvas.height || 1));

    try {
      const capture = await renderer.captureFrame({ width, height });
      const { pixels, bytesPerRow } = capture;

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
    imageData.data[di + 0] = pixels[si + 2]; // R from B
    imageData.data[di + 1] = pixels[si + 1]; // G stays
    imageData.data[di + 2] = pixels[si + 0]; // B from R
    imageData.data[di + 3] = pixels[si + 3]; // A stays
  }
}

      ctx.putImageData(imageData, 0, 0);

      const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
      if (!blob) {
        await modalManager.alert("Failed to create image blob", 'Error');
        return;
      }

      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
      link.download = `shader-${width}x${height}-${timestamp}.png`;
      link.href = URL.createObjectURL(blob);
      link.click();

      modalManager.toast(`PNG exported: ${link.download}`, 'success', 'Export Complete');

      setTimeout(() => URL.revokeObjectURL(link.href), 100);
    } catch (error) {

      await modalManager.alert("Export failed: " + error.message + "\n\nMake sure the preview is actively rendering.", 'Export Error');
    }
  }

  async _exportAnimation() {
    const canvas = this.floatingPreview.gpuCanvas;
    if (!canvas || typeof canvas.captureStream !== "function") {
      await modalManager.alert("Canvas streaming is not supported in this browser.", 'Browser Compatibility');
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      await modalManager.alert("MediaRecorder API is not available. Try a Chromium-based browser.", 'Browser Compatibility');
      return;
    }

    if (typeof window.initWebGPU === "function" && !window._gpuDevice) {
      try {
        await window.initWebGPU(canvas, true);
      } catch (error) {

      }
    }

    const renderer = window.gpuRenderer;
    if (!renderer || typeof renderer.render !== "function") {
      await modalManager.alert("GPU renderer not ready. Render the preview before exporting animation.", 'Error');
      return;
    }

    const defaultFps = Math.max(1, this.settings.refreshRate || 30);
    const fpsInput = await modalManager.prompt("Frames per second for the recording (1-60)?", 'Animation Settings', String(defaultFps), {
      inputType: 'number',
      placeholder: '30',
      validator: (value) => {
        const fps = Number(value);
        if (!Number.isFinite(fps) || fps <= 0 || fps > 60) {
          return 'Please enter a valid FPS value between 1 and 60';
        }
        return null;
      }
    });
    if (fpsInput === null) return;

    const fps = Math.min(60, Math.max(1, Number(fpsInput)));

    const durationInput = await modalManager.prompt("Duration in seconds (1-60)?", 'Animation Settings', "5", {
      inputType: 'number',
      placeholder: '5',
      validator: (value) => {
        const duration = Number(value);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
          return 'Please enter a valid duration between 1 and 60 seconds';
        }
        return null;
      }
    });
    if (durationInput === null) return;

    const duration = Math.min(60, Math.max(1, Number(durationInput)));

    const mimeCandidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const mimeType = mimeCandidates.find((candidate) => {
      try {
        return MediaRecorder.isTypeSupported(candidate);
      } catch {
        return false;
      }
    });

    if (!mimeType) {
      await modalManager.alert("No supported WebM encoder found for this browser.", 'Browser Compatibility');
      return;
    }

    this.floatingPreview.updateSize();
    if (typeof window.render === "function") {
      window.render();
    } else {
      renderer.render();
    }

    const stream = canvas.captureStream(fps);
    const chunks = [];

    let renderInterval = null;
    if (typeof renderer.render === "function" || typeof window.render === "function") {
      const frameInterval = Math.max(1, Math.floor(1000 / fps));
      renderInterval = setInterval(() => {
        try {
          if (typeof window.render === "function") {
            window.render();
          } else {
            renderer.render();
          }
        } catch (error) {

        }
      }, frameInterval);
    }

    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
      });
    } catch (error) {
      if (renderInterval) {
        clearInterval(renderInterval);
      }
      stream.getTracks().forEach((track) => track.stop());
      await modalManager.alert("Unable to start recorder: " + error.message, 'Recording Error');
      return;
    }

    const recordingPromise = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        reject(event.error || new Error("Recording error"));
      };
      recorder.onstop = () => resolve();
    });

    recorder.start();
    modalManager.toast(`Recording ${duration}s animation at ${fps} FPS...`, 'info', 'Export Animation');

    const stopTimer = setTimeout(() => {
      if (recorder.state === "recording") {
        recorder.stop();
      }
    }, duration * 1000);

    try {
      await recordingPromise;
    } catch (error) {

      await modalManager.alert("Animation export failed: " + error.message, 'Export Error');
      return;
    } finally {
      clearTimeout(stopTimer);
      if (renderInterval) {
        clearInterval(renderInterval);
      }
      stream.getTracks().forEach((track) => track.stop());
    }

    if (!chunks.length) {
      await modalManager.alert("Recording produced no data.", 'Export Error');
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    const resolution = this.settings.resolution || { width: canvas.width, height: canvas.height };
    const width = Math.max(1, Math.floor(resolution.width || canvas.width || 1));
    const height = Math.max(1, Math.floor(resolution.height || canvas.height || 1));
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

    const link = document.createElement("a");
    link.download = `shader-${width}x${height}-${timestamp}.webm`;
    link.href = URL.createObjectURL(blob);
    link.click();

    modalManager.toast(`Animation exported: ${link.download}`, 'success', 'Export Complete');

    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
}