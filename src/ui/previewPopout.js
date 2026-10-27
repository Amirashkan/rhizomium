// src/ui/previewPopout.js
//
// Pop the preview out into its own OS window by moving the canvas element, not
// its pixels.
//
// A <canvas> keeps its GPUCanvasContext when it is re-parented — the floating
// preview already moves #gpu-canvas between the editor and its panel. A
// same-origin window that shares our JS agent (a Document Picture-in-Picture
// window, or a window.open() popup that keeps its opener) is just another
// document on the same event loop, so the canvas can be moved there too. The
// same GPURenderer and GPUDevice keep drawing into it and the compositor
// presents it in the other window: no frame copies, no second pipeline, and
// feedback sims stay identical because there is only one sim.
//
// Browser only. Tauri's webviews are separate windows with no shared agent, so
// the desktop app keeps the native re-rendering second monitor
// (TauriSecondMonitorViewer).

import { isTauri } from "../utils/isTauri.js";
import { letterboxRect } from "./letterbox.js";
import { attachColorVisionDocument, POPOUT_CVD_CSS } from "../accessibility/colorVision.js";

const POPUP_NAME = "rhizomium-preview";

/** True where a pop-out window can host the live canvas. */
export function canPopOutPreview(win = window) {
  if (isTauri()) return false;
  return !!win.documentPictureInPicture?.requestWindow || typeof win.open === "function";
}

/**
 * Open a window and move `canvas` into it.
 *
 * Must be called from a user gesture (both APIs require one), and before any
 * await in that handler so the activation is not spent.
 *
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas the live canvas to move
 * @param {number} opts.width initial window content width
 * @param {number} opts.height initial window content height
 * @param {string} [opts.title]
 * @param {() => void} [opts.onClose] called once, after the canvas is back in
 *   its original place, however the window went away
 * @param {Window} [opts.opener]
 * @returns {Promise<{win: Window, kind: 'pip'|'popup', fit: () => void, close: () => void}|null>}
 *   null when no window could be opened (popup blocked). Call `fit()` after
 *   changing the canvas backing size; window resizes refit on their own.
 */
export async function openPreviewPopout({
  canvas,
  width,
  height,
  title = "Rhizomium Preview",
  onClose,
  opener = window,
}) {
  const w = Math.max(160, Math.round(width));
  const h = Math.max(90, Math.round(height));

  let win = null;
  let kind = "pip";
  const pip = opener.documentPictureInPicture;
  if (pip?.requestWindow) {
    try {
      win = await pip.requestWindow({ width: w, height: h });
    } catch {
      win = null; // no activation, or PiP disabled — try a plain popup
    }
  }
  if (!win) {
    kind = "popup";
    try {
      win = opener.open("", POPUP_NAME, `popup,width=${w},height=${h}`);
    } catch {
      win = null;
    }
  }
  if (!win || !win.document) return null;

  const doc = win.document;
  doc.title = title;
  doc.body.replaceChildren();
  doc.documentElement.style.cssText = "height:100%;background:#000;";
  doc.body.style.cssText =
    "margin:0;height:100%;overflow:hidden;background:#000;" +
    "display:flex;align-items:center;justify-content:center;";

  const home = { parent: canvas.parentNode, next: canvas.nextSibling };
  const savedCss = canvas.style.cssText;

  // Explicit CSS size rather than object-fit, so the canvas rect is exactly the
  // image — the Mouse node maps pointer positions through that rect.
  const fit = () => {
    const { dw, dh } = letterboxRect(canvas.width, canvas.height, win.innerWidth, win.innerHeight);
    canvas.style.width = Math.max(1, Math.round(dw)) + "px";
    canvas.style.height = Math.max(1, Math.round(dh)) + "px";
  };

  canvas.style.cssText = "display:block;position:static;";
  doc.body.append(canvas); // append adopts the node into the popup's document
  fit();

  // A colour-vision preview (Preferences → Accessibility) follows the canvas into its window: the
  // filter it references has to exist in this document, which loads none of the editor's CSS.
  const detachColorVision = attachColorVisionDocument(doc, { extraCss: POPOUT_CVD_CSS });

  win.addEventListener("resize", fit);

  // A popup can go fullscreen (projector use); PiP windows refuse, harmlessly.
  const onDblClick = () => {
    if (doc.fullscreenElement) doc.exitFullscreen?.().catch(() => {});
    else doc.documentElement.requestFullscreen?.().catch(() => {});
  };
  canvas.addEventListener("dblclick", onDblClick);

  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    win.removeEventListener("pagehide", restore);
    win.removeEventListener("resize", fit);
    opener.removeEventListener("pagehide", close);
    canvas.removeEventListener("dblclick", onDblClick);
    detachColorVision();
    canvas.style.cssText = savedCss;
    // Bring the canvas home before the window's document is torn down, or it
    // would be destroyed with it.
    if (home.parent?.isConnected) {
      const next = home.next?.parentNode === home.parent ? home.next : null;
      home.parent.insertBefore(canvas, next);
    }
    else opener.document.body.append(canvas);
    try { onClose?.(); } catch (err) { console.error("[previewPopout] onClose failed:", err); }
  };

  function close() {
    restore();
    try { if (!win.closed) win.close(); } catch { /* already gone */ }
  }

  win.addEventListener("pagehide", restore);
  // An editor reload must not leave an orphaned window behind.
  opener.addEventListener("pagehide", close);

  return { win, kind, fit, close };
}
