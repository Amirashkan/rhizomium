// src/ui/FpsMeter.js
//
// Frame-rate readout for the canvas status bar.
//
// It reads presentedFrameRate, which counts the frames the browser actually
// puts on screen. That means it follows the display the window is on: a 60Hz
// panel reads ~60, a 75Hz one reads ~75, and a window on a compositor clocked
// at 48 reads 48 no matter how fast the app is dispatching underneath.
//
// Deliberately not the render loop's own frame count: that loop can be paused,
// throttled, or set to a fixed rate that has nothing to do with the display,
// and this has to keep telling the truth about the window in all of those
// cases.

import { subscribePresentedFps, getPresentedFpsCeiling } from "../core/presentedFrameRate.js";

export class FpsMeter {
  /** @param {HTMLElement} host  the slot the readout is appended to. */
  constructor(host) {
    this.host = host;
    this.el = null;
    this._unsubscribe = null;
    this._fps = 0;
  }

  mount() {
    if (this.el || !this.host) return this.el;
    this._ensureStyles();

    const el = document.createElement("span");
    el.className = "rz-fps";
    // The readout is where someone first notices a number they did not expect,
    // so the explanation belongs here rather than only in the docs.
    el.title =
      "Frames this window is presenting per second.\n\n" +
      "Follows your display, so it reads whatever your monitor refreshes at " +
      "(60, 120, 144…). If it sits below that while the preview's GPU time " +
      "stays low, the frames are being lost outside this app — running two " +
      "displays at different refresh rates can cap every browser window.\n\n" +
      "See docs/frame-rate.md";
    el.innerHTML = `<span class="rz-fps-value">—</span><span class="rz-fps-unit">fps</span>`;
    this.host.appendChild(el);

    this.el = el;
    this.valueEl = el.querySelector(".rz-fps-value");
    this._start();
    return el;
  }

  destroy() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.el?.remove();
    this.el = null;
  }

  _start() {
    this._unsubscribe = subscribePresentedFps((fps) => {
      this._fps = fps;
      this._paint();
    });
  }

  _paint() {
    if (!this.valueEl) return;
    const fps = Math.round(this._fps);
    this.valueEl.textContent = String(fps);

    // Graded against the refresh rate the display is actually capable of, not a
    // hardcoded 60 — on a 75Hz panel, 60fps IS a dropped-frame problem, and on a
    // 48Hz one it is not.
    const ceiling = this._refreshCeiling();
    this.el.classList.toggle("is-poor", fps < ceiling * 0.55);
    this.el.classList.toggle("is-fair", fps >= ceiling * 0.55 && fps < ceiling * 0.85);
  }

  _refreshCeiling() {
    return getPresentedFpsCeiling();
  }

  _ensureStyles() {
    if (document.getElementById("rz-fps-styles")) return;
    const style = document.createElement("style");
    style.id = "rz-fps-styles";
    style.textContent = `
      .rz-fps {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        padding: 0 2px;
        font-family: var(--rz-font-mono);
        font-size: 11px;
        color: var(--rz-text-3);
        user-select: none;
      }

      /* Reserved width and tabular figures: the number changes every half
         second and must not shuffle the bar around it while it does. */
      .rz-fps-value {
        min-width: 22px;
        text-align: right;
        font-variant-numeric: tabular-nums;
        color: var(--rz-text-2);
      }

      .rz-fps-unit {
        color: var(--rz-text-faint);
      }

      .rz-fps.is-fair .rz-fps-value {
        color: var(--rz-warn);
      }

      .rz-fps.is-poor .rz-fps-value {
        color: var(--rz-error);
      }
    `;
    document.head.appendChild(style);
  }
}
