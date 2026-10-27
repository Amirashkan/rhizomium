// src/accessibility/installAccessibility.js
//
// Wires the accessibility layer into a running editor. main.js calls two things:
//
//   prepareAccessibility()   first thing at boot — contrast, size, focus ring and motion attributes
//                            on the page, and the canvas palette, before anything has painted
//   installAccessibility()   once the editor, the preview and the menus exist — the patch outline,
//                            the menu bar keys, the dialogs, colour vision and the motion check
//
// Everything is reachable afterwards as window.rzAccessibility for debugging and for tests that
// drive the real page.

import { getA11ySettings, installA11yDocumentSync } from "./a11ySettings.js";
import { installAnnouncer, announce } from "./announcer.js";
import { installColorVision } from "./colorVision.js";
import { GraphNavigator } from "./GraphNavigator.js";
import { installMenuBarKeyboard } from "./menuBarKeyboard.js";
import {
  openConnectDialog,
  openDisconnectDialog,
  openGoToNodeDialog,
  openDescribePatchDialog,
} from "./graphDialogs.js";
import { MotionGate, checkPatchMotion } from "./motionSafety.js";
import { applyContrastPalette } from "../core/theme.js";

/**
 * Before the editor exists: put the settings on the document and the canvas palette at the right
 * contrast, so the first frame is already in the contrast the artist asked for.
 */
export function prepareAccessibility({ settings = getA11ySettings(), doc = document } = {}) {
  installA11yDocumentSync(settings, doc);
  applyContrastPalette(settings.effectiveContrast());
  return settings;
}

/**
 * @param {object} options
 * @param {object} options.editor
 * @param {object} [options.previewTiming]  { isPaused, setPaused, getTimeScale, setTimeScale }
 * @param {() => number} [options.getAspect]   the output's aspect ratio, for the motion check
 * @param {(filter?: string) => void} [options.showKeyboardHelp]
 * @param {(message: string, kind?: string) => void} [options.updateStatus]
 */
export function installAccessibility({
  editor,
  previewTiming = null,
  getAspect = () => 16 / 9,
  showKeyboardHelp = null,
  updateStatus = () => {},
  settings = getA11ySettings(),
  doc = document,
} = {}) {
  installAnnouncer(doc);

  const repaint = (reason) => {
    editor?.markDirty?.(reason, "full", { full: true, useThrottling: false });
    editor?.draw?.();
  };

  // ---- contrast reaches the drawn graph, and panels built from the palette --------------------
  settings.subscribe(() => {
    if (applyContrastPalette(settings.effectiveContrast())) {
      repaint("a11y-contrast");
      // The parameter panel paints its rows from the palette when it renders; re-render the node
      // it is showing so its text picks up the new contrast now rather than on the next click.
      const panel = editor?.paramPanel;
      if (panel?.selectedNode && panel.panel?.style?.display !== "none") {
        panel.renderParameters?.(panel.selectedNode);
      }
    }
  });

  // ---- colour vision on the preview, thumbnails and 3D view -----------------------------------
  installColorVision({ settings, doc, onChange: () => repaint("a11y-color-vision") });

  // ---- the patch outline ----------------------------------------------------------------------
  const dialogs = {
    connect: ({ from, to, onDone } = {}) => openConnectDialog({ editor, from, to, onDone }),
    disconnect: ({ nodeId, onDone } = {}) => openDisconnectDialog({ editor, nodeId, onDone }),
    goTo: ({ onPick, onCancel } = {}) => openGoToNodeDialog({ editor, onPick, onCancel }),
    describePatch: () => openDescribePatchDialog({ editor }),
  };
  const navigator = new GraphNavigator({ editor, settings, dialogs }).install();
  if (editor) editor.graphNavigator = navigator;
  editor?.canvas?.setAttribute("aria-label", "Patch canvas");
  // The render is a picture as far as assistive technology is concerned; Describe Patch and the
  // outline are where its structure is.
  const preview = doc.getElementById("gpu-canvas");
  preview?.setAttribute("role", "img");
  preview?.setAttribute("aria-label", "Live preview of the patch");

  // ---- the menu bar ---------------------------------------------------------------------------
  const stopMenuBar = installMenuBarKeyboard({ doc });

  // ---- the motion check -----------------------------------------------------------------------
  const runCheck = () =>
    checkPatchMotion({
      graph: editor?.graph,
      renderer: window.gpuRenderer,
      timeScale: previewTiming?.getTimeScale?.() ?? 1,
      startTime: window.renderLoop?.getState?.().simTime ?? 0,
      aspect: getAspect(),
    });
  const waitForShader = () =>
    new Promise((resolve) => {
      const done = () => {
        window.removeEventListener("rz:shader-built", done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 600);
      window.addEventListener("rz:shader-built", done);
    });
  const motionGate = new MotionGate({ settings, timing: previewTiming, check: runCheck, waitForShader });
  motionGate.install(window);

  // ---- menu rows ------------------------------------------------------------------------------
  const onClick = (id, handler) => {
    const el = doc.getElementById(id);
    if (!el) return;
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handler(event);
    });
  };

  // Where a dialog opened from the outline should hand focus back to.
  const returnToOutline = () => {
    if (navigator.hasFocus()) return () => navigator.focus();
    return null;
  };

  onClick("btn-accessibility", () => {
    window.preferencesWindow?.show?.({ section: "accessibility" });
    updateStatus("Accessibility settings");
  });

  onClick("btn-focus-canvas", () => {
    navigator.focus();
    const count = editor?.graph?.nodes?.length || 0;
    announce(count ? `Patch canvas, ${count} ${count === 1 ? "node" : "nodes"}.` : "Patch canvas, empty.");
  });

  const pauseRow = doc.getElementById("btn-pause-preview");
  const paintPauseRow = () => {
    if (!pauseRow || !previewTiming) return;
    const paused = !!previewTiming.isPaused();
    pauseRow.textContent = paused ? "Play Preview" : "Pause Preview";
    pauseRow.setAttribute("aria-pressed", String(paused));
  };
  onClick("btn-pause-preview", () => {
    if (!previewTiming) return;
    const paused = !previewTiming.isPaused();
    previewTiming.setPaused(paused);
    paintPauseRow();
    announce(paused ? "Preview paused." : "Preview playing.");
    updateStatus(paused ? "Preview paused" : "Preview playing");
  });
  // Repaint whenever the View menu opens: the clock can also be paused from Preview settings and
  // by the motion check.
  doc.getElementById("menu-view")?.addEventListener("click", paintPauseRow);
  paintPauseRow();

  onClick("btn-check-motion", () => {
    updateStatus("Checking for flashing and fast motion…");
    motionGate
      .checkNow()
      .then((report) => {
        updateStatus(report.risk === "none" ? "No flashing found" : "Flashing or fast motion found", report.risk === "none" ? "info" : "warning");
        paintPauseRow();
      })
      .catch((error) => {
        console.warn("[accessibility] Motion check failed:", error);
        updateStatus("Motion check failed", "error");
      });
  });

  onClick("btn-describe-patch", () => {
    openDescribePatchDialog({ editor });
  });

  // Node → Pins. Seeded from where the keyboard is, when it is on a port in the outline.
  onClick("btn-connect-pins", () => {
    const focus = navigator.hasFocus() ? navigator.renderFocus() : null;
    const back = returnToOutline();
    openConnectDialog({
      editor,
      from: focus?.part === "output" ? { nodeId: focus.nodeId, pin: focus.pin } : null,
      to: focus?.part === "input" ? { nodeId: focus.nodeId, pin: focus.pin } : null,
      onDone: (result) => {
        navigator.refresh();
        if (result?.to && back) navigator.focusItem(`in:${result.to.nodeId}:${result.to.pin}`);
        else back?.();
      },
    });
  });
  onClick("btn-disconnect-pins", () => {
    const selection = editor?.graph?.selection;
    const nodeId = selection?.size === 1 ? [...selection][0] : null;
    const back = returnToOutline();
    openDisconnectDialog({
      editor,
      nodeId,
      onDone: () => {
        navigator.refresh();
        back?.();
      },
    });
  });

  // The skip link at the top of the page.
  const skip = doc.getElementById("rz-skip-to-canvas");
  skip?.addEventListener("click", (event) => {
    event.preventDefault();
    navigator.focus();
  });

  const api = {
    settings,
    navigator,
    motionGate,
    announce,
    showKeyboardHelp,
    dialogs,
    dispose() {
      stopMenuBar();
      navigator.dispose();
    },
  };
  window.rzAccessibility = api;
  window.motionGate = motionGate;
  return api;
}
