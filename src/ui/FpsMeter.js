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

    // The readout is where someone first notices a number they did not expect,
    // so the explanation belongs here and not only in the docs. Built rather
    // than left to title=: this is too much text for a native tooltip, which
    // waits a second, cannot be styled and would be hanging off a 50px target
    // in the corner of the window. Borrows .rz-sb-tooltip from the status bar
    // that hosts this, so it behaves exactly like the wire-colour legend's.
    const el = document.createElement("span");
    el.className = "rz-fps-wrap";
    el.innerHTML = `
      <span class="rz-fps" tabindex="0" aria-describedby="rz-fps-tip">
        <span class="rz-fps-value">—</span><span class="rz-fps-unit">fps</span>
      </span>
      <span class="rz-sb-tooltip rz-fps-tip" id="rz-fps-tip" role="tooltip">
        <span class="rz-sb-tip-title">Frame rate</span>
        <span class="rz-fps-tip-body">
          Frames this window is presenting each second. It follows your display,
          so it reads whatever your monitor refreshes at — 60, 120, 144.
        </span>
        <span class="rz-fps-tip-body">
          Sitting below that while the preview's <b>ms GPU</b> stays low means
          the frames are being lost outside this app. Two displays at different
          refresh rates can cap every browser window.
        </span>
        <span class="rz-fps-tip-foot">Help ▸ Documentation ▸ Frame Rate &amp; Display Refresh</span>
      </span>
    `;
    this.host.appendChild(el);

    this.el = el;
    this.meterEl = el.querySelector(".rz-fps");
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
    // On the readout itself, not the wrapper the tooltip hangs from.
    const ceiling = this._refreshCeiling();
    this.meterEl.classList.toggle("is-poor", fps < ceiling * 0.55);
    this.meterEl.classList.toggle("is-fair", fps >= ceiling * 0.55 && fps < ceiling * 0.85);
  }

  _refreshCeiling() {
    return getPresentedFpsCeiling();
  }

  _ensureStyles() {
    if (document.getElementById("rz-fps-styles")) return;
    const style = document.createElement("style");
    style.id = "rz-fps-styles";
    style.textContent = `
      /* Anchors the tooltip, which is positioned against it. */
      .rz-fps-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }

      .rz-fps {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        padding: 0 2px;
        cursor: help;
        outline: none;
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

      /* .rz-sb-tooltip centres itself on its anchor, which would hang this one
         off the right edge of the window — it is the last thing in the bar.
         Anchor it to that edge instead. */
      .rz-fps-tip {
        left: auto;
        right: -6px;
        transform: translateY(4px);
        max-width: 300px;
      }

      .rz-fps-wrap:hover .rz-fps-tip,
      .rz-fps:focus-visible ~ .rz-fps-tip {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .rz-fps-tip-body {
        font-family: var(--rz-font-ui);
        font-size: 11px;
        line-height: 1.5;
        color: var(--rz-text-2);
      }

      .rz-fps-tip-body b {
        color: var(--rz-text-1);
        font-weight: 600;
      }

      /* Where the whole story lives, for anyone the two paragraphs above did
         not settle it for. */
      .rz-fps-tip-foot {
        font-size: 10px;
        line-height: 1.4;
        color: var(--rz-text-faint);
        border-top: 1px solid var(--rz-line);
        padding-top: 6px;
      }
    `;
    document.head.appendChild(style);
  }
}
