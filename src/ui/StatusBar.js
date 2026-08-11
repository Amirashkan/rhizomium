// src/ui/StatusBar.js
//
// The canvas status bar: a translucent strip along the bottom of the graph that
// answers the questions you'd otherwise have to go looking for — how far am I
// zoomed, where is my cursor in graph space, is the GPU actually up, what do the
// wire colours mean, and where is the timeline.
//
// It reads live state and never owns any. Everything here is a view onto
// something else (the viewport, the GPU renderer, the timeline), so nothing in
// the app has to push updates into it; it samples on a slow timer and on the
// events that actually move a value.

import { TYPE_COLORS } from "../core/theme.js";

// How often the sampled readouts refresh. Fast enough to feel live, slow enough
// that it never competes with the render loop — the cursor readout doesn't wait
// for it, since that one updates straight off the pointer event.
const SAMPLE_MS = 250;

// The legend, in the order a signal usually travels: a coordinate becomes a
// value, values become colour, colour lands in a texture.
const TYPE_LEGEND = [
  { label: "vec", color: TYPE_COLORS.vec2 },
  { label: "float", color: TYPE_COLORS.f32 },
  { label: "color", color: TYPE_COLORS.vec4 },
  { label: "tex", color: TYPE_COLORS.texture },
];

export class StatusBar {
  /**
   * @param {object} editor  the Editor — read for viewport and canvas only.
   */
  constructor(editor) {
    this.editor = editor;
    this.el = null;
    this._timer = null;
    this._cursor = { x: 0, y: 0 };
  }

  mount() {
    if (this.el) return this.el;
    this._ensureStyles();

    const el = document.createElement("div");
    el.id = "canvas-status-bar";
    el.className = "rz-statusbar";
    el.innerHTML = `
      <span class="rz-sb-item" title="Zoom level"
        ><span class="rz-sb-zoom">100%</span></span
      >
      <span class="rz-sb-sep">|</span>
      <span class="rz-sb-item" title="GPU backend">
        <span class="rz-sb-dot rz-sb-gpu-dot"></span><span class="rz-sb-gpu">WebGPU</span>
      </span>
      <span class="rz-sb-sep">|</span>
      <span class="rz-sb-item rz-sb-cursor" title="Cursor position in graph space">x 0  y 0</span>
      <span class="rz-sb-item rz-sb-nodes" title="Nodes · connections">0 nodes</span>
      <span class="rz-sb-spacer"></span>
      <span class="rz-sb-legend-label">TYPES</span>
      ${TYPE_LEGEND.map(
        (t) =>
          `<span class="rz-sb-item"><span class="rz-sb-dot" style="background:${t.color}"></span>${t.label}</span>`,
      ).join("")}
      <span class="rz-sb-spacer"></span>
      <span class="rz-sb-item rz-sb-transport" title="Timeline position">
        <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
        <span class="rz-sb-time">0:00 / 0:00</span>
      </span>
      <span class="rz-sb-sep">|</span>
      <span class="rz-sb-item rz-sb-fps" title="Frames per second">— fps</span>
    `;

    document.body.appendChild(el);
    this.el = el;

    this.zoomEl = el.querySelector(".rz-sb-zoom");
    this.gpuEl = el.querySelector(".rz-sb-gpu");
    this.gpuDotEl = el.querySelector(".rz-sb-gpu-dot");
    this.cursorEl = el.querySelector(".rz-sb-cursor");
    this.nodesEl = el.querySelector(".rz-sb-nodes");
    this.timeEl = el.querySelector(".rz-sb-time");
    this.transportEl = el.querySelector(".rz-sb-transport");
    this.fpsEl = el.querySelector(".rz-sb-fps");

    this._bindCursor();
    this._startFpsSampler();
    this.update();
    this._timer = setInterval(() => this.update(), SAMPLE_MS);
    return el;
  }

  destroy() {
    clearInterval(this._timer);
    this._timer = null;
    if (this._fpsRaf) cancelAnimationFrame(this._fpsRaf);
    this._fpsRaf = null;
    if (this._onPointerMove && this.editor?.canvas) {
      this.editor.canvas.removeEventListener("pointermove", this._onPointerMove);
      this._onPointerMove = null;
    }
    this.el?.remove();
    this.el = null;
  }

  /**
   * The cursor readout tracks the pointer directly rather than waiting for the
   * sample timer — a position that lags a quarter second behind the mouse reads
   * as broken.
   */
  _bindCursor() {
    const canvas = this.editor?.canvas;
    if (!canvas) return;
    this._onPointerMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const pos = this.editor.viewport?.screenToCanvas?.(
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      if (!pos) return;
      this._cursor = pos;
      if (this.cursorEl) {
        this.cursorEl.textContent = `x ${Math.round(pos.x)}  y ${Math.round(pos.y)}`;
      }
    };
    canvas.addEventListener("pointermove", this._onPointerMove, { passive: true });
  }

  update() {
    if (!this.el) return;

    const scale = this.editor?.viewport?.scale;
    if (this.zoomEl && Number.isFinite(scale)) {
      this.zoomEl.textContent = `${Math.round(scale * 100)}%`;
    }

    // "Online" means a device was actually acquired, not merely that the
    // browser advertises the API — a lost device has to read as offline.
    const online = !!window.gpuRenderer?.device;
    if (this.gpuDotEl) {
      this.gpuDotEl.classList.toggle("is-online", online);
      this.gpuDotEl.classList.toggle("is-offline", !online);
    }
    if (this.gpuEl) {
      this.gpuEl.textContent = online
        ? "WebGPU"
        : navigator.gpu
          ? "GPU starting…"
          : "No WebGPU";
    }

    const graph = this.editor?.graph;
    if (this.nodesEl && graph) {
      const n = graph.nodes?.length || 0;
      const c = graph.connections?.length || 0;
      this.nodesEl.textContent = `${n} node${n === 1 ? "" : "s"} · ${c} wire${c === 1 ? "" : "s"}`;
    }

    const timeline = window.timelineManager;
    if (this.timeEl && timeline?.getCurrentTime) {
      const now = timeline.getCurrentTime() || 0;
      const total = timeline.getDuration?.() || 0;
      this.timeEl.textContent = `${this._clock(now)} / ${this._clock(total)}`;
      this.transportEl?.classList.toggle("is-playing", !!timeline.isPlaying?.());
    }

    if (this.fpsEl) {
      this.fpsEl.textContent = this._fps > 0 ? `${Math.round(this._fps)} fps` : "— fps";
    }
  }

  /**
   * Measure the page's own frame rate.
   *
   * The preview panel has an FPS counter, but it only runs while that panel is
   * open — the bar has to show a number whether or not the preview is up, so it
   * counts its own frames. One rAF per frame doing nothing but incrementing a
   * counter is not something the render loop will notice.
   */
  _startFpsSampler() {
    this._fps = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (now) => {
      frames++;
      const elapsed = now - last;
      if (elapsed >= 500) {
        // Smoothed a little, so the readout doesn't flicker between two values.
        const sample = (frames * 1000) / elapsed;
        this._fps = this._fps ? this._fps * 0.6 + sample * 0.4 : sample;
        frames = 0;
        last = now;
      }
      this._fpsRaf = requestAnimationFrame(tick);
    };
    this._fpsRaf = requestAnimationFrame(tick);
  }

  _clock(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  _ensureStyles() {
    if (document.getElementById("rz-statusbar-styles")) return;
    const style = document.createElement("style");
    style.id = "rz-statusbar-styles";
    style.textContent = `
      /* Sits over the canvas rather than taking a slice out of it: the graph
         scrolls under it, and translucency keeps whatever is beneath legible. */
      .rz-statusbar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        height: 38px;
        z-index: 120;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 0 16px;
        background: rgba(16, 13, 11, 0.78);
        backdrop-filter: blur(12px);
        border-top: 1px solid var(--rz-line);
        font-family: var(--rz-font-mono);
        font-size: 11px;
        color: var(--rz-text-3);
        user-select: none;
        pointer-events: none;
      }

      /* Only the readouts that mean something on hover take the pointer, so the
         bar never steals a drag that belongs to the canvas. */
      .rz-statusbar .rz-sb-item {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        pointer-events: auto;
      }

      .rz-sb-sep {
        color: #4f4840;
      }

      .rz-sb-spacer {
        flex: 1;
      }

      .rz-sb-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex: none;
        background: var(--rz-text-faint);
      }

      .rz-sb-gpu-dot.is-online {
        background: var(--rz-success);
        box-shadow: 0 0 7px var(--rz-success);
      }

      .rz-sb-gpu-dot.is-offline {
        background: var(--rz-error);
        box-shadow: 0 0 7px var(--rz-error);
      }

      .rz-sb-legend-label {
        font-family: var(--rz-font-ui);
        letter-spacing: 0.6px;
        color: var(--rz-text-faint);
      }

      .rz-sb-cursor,
      .rz-sb-zoom {
        font-variant-numeric: tabular-nums;
      }

      .rz-sb-transport svg {
        fill: var(--rz-text-faint);
      }

      /* The play glyph is the one thing here that goes accent, and only while
         the timeline is actually running. */
      .rz-sb-transport.is-playing svg {
        fill: var(--rz-accent);
      }

      .rz-sb-transport.is-playing .rz-sb-time {
        color: var(--rz-text-2);
      }
    `;
    document.head.appendChild(style);
  }
}
