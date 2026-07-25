/**
 * PreviewSettings.js - Render settings state for the floating preview.
 *
 * This holds the live render state (resolution, timing, time scale, adaptive
 * quality) and applies changes to the renderer. It owns no UI: every control
 * lives in the single settings window (PreviewExportSettingsWindow), which
 * writes here through updateSetting().
 *
 * The resolution itself is not stored here - it is delegated to the single
 * render-resolution store (RenderResolution.js) so preview, export and publish
 * can never drift apart.
 */

import {
  getRenderResolution,
  setRenderResolution,
  subscribeRenderResolution,
} from './RenderResolution.js';

export class PreviewSettings {
  constructor(floatingPreview) {
    this.floatingPreview = floatingPreview;

    this.settings = {
      refreshRate: 60,
      timingMode: "fixed",
      timeScale: 1.0,
      isPaused: false,
      showFPS: false,
      adaptiveQuality: {
        // Adaptive quality is an automatic performance safety net, not a
        // resolution control: it temporarily scales the render down when frame
        // times blow past budget, then restores it.
        enabled: false,
        lightMode: false,
        autoEnable: true,
        interactionScale: 0.7,
        resolutionScale: 0.75,
        cooldownMs: 350,
      },
    };

    // resolution is a view onto the shared render-resolution store.
    Object.defineProperty(this.settings, "resolution", {
      enumerable: true,
      get: () => getRenderResolution(),
      set: (value) => {
        setRenderResolution(
          value?.width ?? getRenderResolution().width,
          value?.height ?? getRenderResolution().height,
          "previewSettings",
        );
      },
    });

    this._resolutionApplyTimer = null;
    this._unsubscribeResolution = subscribeRenderResolution(() => {
      this._scheduleResolutionApply();
    });
  }

  /** Stop following the shared render resolution (used when tearing down). */
  dispose() {
    this._unsubscribeResolution?.();
    this._unsubscribeResolution = null;
    if (this._resolutionApplyTimer) {
      clearTimeout(this._resolutionApplyTimer);
      this._resolutionApplyTimer = null;
    }
  }

  /** The settings window is the single home for every render control. */
  showSettings() {
    window.previewExportSettingsWindow?.show();
  }

  hideSettings() {
    window.previewExportSettingsWindow?.hide();
  }

  updateSetting(key, value) {
    if (key === "resolution.width" || key === "resolution.height") {
      const current = getRenderResolution();
      const width = key === "resolution.width" ? value : current.width;
      const height = key === "resolution.height" ? value : current.height;
      setRenderResolution(width, height, "updateSetting");
      return;
    }

    if (key.includes(".")) {
      const [parent, child] = key.split(".");
      if (!this.settings[parent]) this.settings[parent] = {};
      this.settings[parent][child] = value;
    } else {
      this.settings[key] = value;
    }

    this._applySetting(key, value);

    // Keep the settings window in sync when a change came from elsewhere
    // (keyboard shortcut, preset, reset).
    window.previewExportSettingsWindow?.syncControl?.(key, value);
  }

  _applySetting(key, value) {
    switch (key) {
      case "showFPS":
        this._updateFPSDisplay(value);
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
      case "adaptiveQuality.lightMode":
      case "adaptiveQuality.autoEnable":
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

  /**
   * Coalesce resolution changes: setting width and height separately must not
   * trigger two GPU resizes/rebuilds back to back.
   */
  _scheduleResolutionApply() {
    if (this._resolutionApplyTimer) return;
    this._resolutionApplyTimer = setTimeout(() => {
      this._resolutionApplyTimer = null;
      this._updateResolution();
    }, 0);
  }

  async _updateResolution() {
    if (!this.floatingPreview?.gpuCanvas) return;

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

    // updateSize() awaits _rebuildAfterResize(), which restarts the render loop
    // itself once initialize() has fully completed.
    await this.floatingPreview.updateSize();
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

    if (window.renderLoop) {
      window.renderLoop.setMode(normalized);
      if (normalized === "fixed") {
        window.renderLoop.setFixedFps(this.settings.refreshRate);
      }
      window.renderLoop.renderNow({ advance: false });
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
}
