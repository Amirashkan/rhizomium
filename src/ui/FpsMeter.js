// src/ui/FpsMeter.js
//
// Frame-rate readout for the canvas status bar.
//
// It counts requestAnimationFrame callbacks, which is the rate the browser
// actually presents frames at — the same thing every other app's FPS counter
// reports. That means it follows the display the window is on: a 60Hz panel
// reads ~60, a 75Hz one reads ~75, and a window straddling two of them reads
// whichever the compositor is driving. A number lower than the panel's refresh
// is real work not finishing in time, not a fault in the counting.
//
// Deliberately not the render loop's own frame count: that loop can be paused,
// throttled to a fixed rate, or stopped entirely from the status bar, and this
// has to keep telling the truth about the window in all of those cases.

// Averaging window. Long enough that the number doesn't twitch, short enough
// that a stall shows up while you are still looking at what caused it.
const WINDOW_MS = 500;

export class FpsMeter {
  /** @param {HTMLElement} host  the slot the readout is appended to. */
  constructor(host) {
    this.host = host;
    this.el = null;
    this._raf = null;
    this._fps = 0;
  }

  mount() {
    if (this.el || !this.host) return this.el;
    this._ensureStyles();

    const el = document.createElement("span");
    el.className = "rz-fps";
    el.title = "Frames per second (display refresh rate)";
    el.innerHTML = `<span class="rz-fps-value">—</span><span class="rz-fps-unit">fps</span>`;
    this.host.appendChild(el);

    this.el = el;
    this.valueEl = el.querySelector(".rz-fps-value");
    this._start();
    return el;
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.el?.remove();
    this.el = null;
  }

  _start() {
    let frames = 0;
    let last = performance.now();

    const tick = (now) => {
      frames++;
      const elapsed = now - last;
      if (elapsed >= WINDOW_MS) {
        const sample = (frames * 1000) / elapsed;
        // Light smoothing only. Heavier averaging hides exactly the dips this
        // is here to reveal.
        this._fps = this._fps ? this._fps * 0.5 + sample * 0.5 : sample;
        frames = 0;
        last = now;
        this._paint();
      }
      this._raf = requestAnimationFrame(tick);
    };

    this._raf = requestAnimationFrame(tick);
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

  /**
   * The best frame rate seen so far, used as the display's refresh rate.
   *
   * The platform exposes no refresh-rate API, so the highest rate the window has
   * actually achieved is the closest honest stand-in. Moving the window to a
   * slower display leaves the ceiling too high for a while, which errs toward
   * flagging a problem rather than hiding one.
   */
  _refreshCeiling() {
    this._peak = Math.max(this._peak || 0, this._fps);
    return Math.max(30, this._peak);
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
