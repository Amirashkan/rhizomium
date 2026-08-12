// src/ui/StatusBar.js
//
// The canvas status bar: a translucent strip along the bottom of the graph that
// answers the questions you'd otherwise have to go looking for — how far am I
// zoomed, where is my cursor in graph space, is the GPU actually running, what
// do the wire colours mean, and what did the app just say.
//
// It reads live state and owns almost none. Everything here is a view onto
// something else (the viewport, the render loop, the graph, the timeline), so
// nothing in the app has to push updates into it; it samples on a slow timer and
// on the events that actually move a value.
//
// The one control it owns is the render toggle, which stops and starts the
// render loop — see _toggleRender.

import { TYPE_COLORS } from "../core/theme.js";

// How often the sampled readouts refresh. Fast enough to feel live, slow enough
// that it never competes with the render loop — the cursor readout doesn't wait
// for it, since that one updates straight off the pointer event.
const SAMPLE_MS = 250;

// The legend, in the order a signal usually travels: a coordinate becomes a
// value, values become colour, colour lands in a texture.
const TYPE_LEGEND = [
  { label: "vec", color: TYPE_COLORS.vec2, note: "vec2 / vec3 — coordinates and directions" },
  { label: "float", color: TYPE_COLORS.f32, note: "f32 / int — a single number" },
  { label: "color", color: TYPE_COLORS.vec4, note: "vec4 — colour with alpha" },
  { label: "tex", color: TYPE_COLORS.texture, note: "texture — an image from a compute pass" },
];

export class StatusBar {
  /**
   * @param {object} editor  the Editor — read for viewport, canvas and graph.
   */
  constructor(editor) {
    this.editor = editor;
    this.el = null;
    this._timer = null;
    // Whether the user has switched rendering off from here. Kept separately
    // from the loop's own running flag: the loop also stops for its own reasons
    // (no GPU yet, a settings restart), and those must not read as "the user
    // turned this off".
    this.rendersDisabled = false;
  }

  mount() {
    if (this.el) return this.el;
    this._ensureStyles();

    const el = document.createElement("div");
    el.id = "canvas-status-bar";
    el.className = "rz-statusbar";
    // Three sections, each taking an equal share of the width. Readouts change
    // length constantly — the cursor gains a digit, a status message arrives —
    // and in one flat flex row every one of those shifted everything after it.
    // Sections give each group its own space to move within.
    el.innerHTML = `
      <div class="rz-sb-section rz-sb-left">
        <span class="rz-sb-item" title="Zoom level"><span class="rz-sb-zoom">100%</span></span>
        <span class="rz-sb-sep">|</span>
        <button type="button" class="rz-sb-btn rz-sb-render">
          <span class="rz-sb-dot rz-sb-gpu-dot"></span><span class="rz-sb-render-label">Live</span>
        </button>
        <span class="rz-sb-sep">|</span>
        <span class="rz-sb-item rz-sb-cursor" title="Cursor position in graph space">x 0  y 0</span>
      </div>

      <div class="rz-sb-section rz-sb-center">
        <span class="rz-sb-item rz-sb-nodes" title="Nodes and wires in the graph">0 nodes</span>
        <span class="rz-sb-item rz-sb-selection" hidden>0 selected</span>
        <span class="rz-sb-sep">|</span>
        <span class="rz-sb-legend-wrap">
          <button type="button" class="rz-sb-btn rz-sb-legend-btn" aria-describedby="rz-sb-legend-tip">
            <span class="rz-sb-dot rz-sb-legend-swatches"></span>TYPES
          </button>
          <span class="rz-sb-tooltip" id="rz-sb-legend-tip" role="tooltip">
            <span class="rz-sb-tip-title">Wire colours</span>
            ${TYPE_LEGEND.map(
              (t) => `<span class="rz-sb-tip-row">
                <span class="rz-sb-dot" style="background:${t.color}"></span>
                <b>${t.label}</b><span>${t.note}</span>
              </span>`,
            ).join("")}
          </span>
        </span>
      </div>

      <div class="rz-sb-section rz-sb-right">
        <span class="rz-sb-item rz-sb-transport" title="Timeline position">
          <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          <span class="rz-sb-time">0:00 / 0:00</span>
        </span>
        <span class="rz-sb-sep">|</span>
        <span class="rz-sb-fps-slot"></span>
      </div>
    `;

    document.body.appendChild(el);
    this.el = el;

    this.zoomEl = el.querySelector(".rz-sb-zoom");
    this.renderBtn = el.querySelector(".rz-sb-render");
    this.renderLabelEl = el.querySelector(".rz-sb-render-label");
    this.gpuDotEl = el.querySelector(".rz-sb-gpu-dot");
    this.cursorEl = el.querySelector(".rz-sb-cursor");
    this.nodesEl = el.querySelector(".rz-sb-nodes");
    this.selectionEl = el.querySelector(".rz-sb-selection");
    this.timeEl = el.querySelector(".rz-sb-time");
    this.transportEl = el.querySelector(".rz-sb-transport");
    // Filled by FpsMeter, which owns its own sampling — the bar only lends it
    // a place to stand.
    this.fpsSlot = el.querySelector(".rz-sb-fps-slot");

    this._paintLegendSwatches(el.querySelector(".rz-sb-legend-swatches"));
    this.renderBtn.addEventListener("click", () => this._toggleRender());

    this._bindCursor();
    this.update();
    this._timer = setInterval(() => this.update(), SAMPLE_MS);
    return el;
  }

  destroy() {
    clearInterval(this._timer);
    this._timer = null;
    if (this._onPointerMove && this.editor?.canvas) {
      this.editor.canvas.removeEventListener("pointermove", this._onPointerMove);
      this._onPointerMove = null;
    }
    this.el?.remove();
    this.el = null;
  }

  /** The legend button wears the four colours it explains. */
  _paintLegendSwatches(dot) {
    if (!dot) return;
    const stops = TYPE_LEGEND.map((t, i) => {
      const from = (i / TYPE_LEGEND.length) * 100;
      const to = ((i + 1) / TYPE_LEGEND.length) * 100;
      return `${t.color} ${from}% ${to}%`;
    }).join(", ");
    dot.style.background = `conic-gradient(from 180deg, ${stops})`;
  }

  /**
   * Stop or restart the render loop.
   *
   * Stopping the loop is the honest way to "disable all renders": no frames are
   * produced at all, so the GPU work, the preview panels and the node
   * thumbnails all go quiet together rather than each being muted separately.
   * The graph stays fully editable — the canvas is drawn by the 2D renderer,
   * which is not on this loop.
   */
  _toggleRender() {
    const loop = window.renderLoop;
    if (!loop) return;

    this.rendersDisabled = !this.rendersDisabled;
    if (this.rendersDisabled) {
      loop.stop();
    } else {
      loop.start();
      // One frame immediately, so switching back doesn't wait for whatever
      // would otherwise have triggered the next render.
      loop.renderNow?.({ advance: false });
    }
    this.update();
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

    this._updateRenderState();

    const graph = this.editor?.graph;
    if (this.nodesEl && graph) {
      const n = graph.nodes?.length || 0;
      const c = graph.connections?.length || 0;
      this.nodesEl.textContent = `${n} node${n === 1 ? "" : "s"} · ${c} wire${c === 1 ? "" : "s"}`;
    }

    // Selection only takes room on the bar when there is one.
    if (this.selectionEl) {
      const selected = graph?.selection?.size || 0;
      this.selectionEl.hidden = selected === 0;
      if (selected) this.selectionEl.textContent = `${selected} selected`;
    }

    const timeline = window.timelineManager;
    if (this.timeEl && timeline?.getCurrentTime) {
      const now = timeline.getCurrentTime() || 0;
      const total = timeline.getDuration?.() || 0;
      this.timeEl.textContent = `${this._clock(now)} / ${this._clock(total)}`;
      this.transportEl?.classList.toggle("is-playing", !!timeline.isPlaying?.());
    }
  }

  _updateRenderState() {
    // "Online" means a device was actually acquired, not merely that the
    // browser advertises the API — a lost device has to read as offline.
    const online = !!window.gpuRenderer?.device;
    const off = this.rendersDisabled;

    if (this.gpuDotEl) {
      this.gpuDotEl.classList.toggle("is-online", online && !off);
      this.gpuDotEl.classList.toggle("is-offline", !online && !off);
      this.gpuDotEl.classList.toggle("is-paused", off);
    }

    if (this.renderLabelEl) {
      // The label names the STATE the button is reporting, not the technology
      // behind it — "WebGPU" told you nothing about what clicking would do.
      // Which backend is in use belongs in the tooltip.
      this.renderLabelEl.textContent = off
        ? "Renders off"
        : online
          ? "Live"
          : navigator.gpu
            ? "Starting…"
            : "No GPU";
    }

    if (this.renderBtn) {
      this.renderBtn.classList.toggle("is-off", off);
      this.renderBtn.disabled = !window.renderLoop;
      this.renderBtn.title = off
        ? "Rendering is stopped — click to resume"
        : online
          ? "Rendering live on WebGPU — click to stop (the graph stays editable)"
          : navigator.gpu
            ? "Waiting for the GPU device"
            : "WebGPU is unavailable in this browser";
    }
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
        gap: 12px;
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
      .rz-statusbar .rz-sb-item,
      .rz-statusbar .rz-sb-btn,
      .rz-statusbar .rz-sb-legend-wrap,
      .rz-statusbar #status {
        pointer-events: auto;
      }

      .rz-statusbar .rz-sb-item {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      .rz-sb-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: var(--rz-r-pill);
        border: 1px solid transparent;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }

      .rz-sb-btn:hover:not(:disabled) {
        background: var(--rz-fill-soft);
        border-color: var(--rz-line);
        color: var(--rz-text-2);
      }

      .rz-sb-btn:disabled {
        cursor: default;
        opacity: 0.5;
      }

      /* Rendering stopped is a state you must not be able to miss — it is the
         one thing on this bar that can make the app look broken. */
      .rz-sb-render.is-off,
      .rz-sb-render.is-off:hover {
        background: var(--rz-warn-soft);
        border-color: rgba(245, 165, 36, 0.35);
        color: var(--rz-warn);
      }

      /* Equal thirds. min-width:0 is what lets a section's contents shrink
         (and the status ellipsize) instead of pushing its neighbours. */
      .rz-sb-section {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1 1 0;
        min-width: 0;
      }

      .rz-sb-center {
        justify-content: center;
      }

      .rz-sb-right {
        justify-content: flex-end;
      }

      .rz-sb-sep {
        color: #4f4840;
        flex: none;
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

      .rz-sb-gpu-dot.is-paused {
        background: var(--rz-warn);
        box-shadow: none;
      }

      .rz-sb-legend-swatches {
        width: 9px;
        height: 9px;
      }

      .rz-sb-legend-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }

      /* Built rather than borrowed from title=: a native tooltip waits a second,
         can't carry the swatches, and would explain colour without showing it. */
      .rz-sb-tooltip {
        position: absolute;
        bottom: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%) translateY(4px);
        min-width: 260px;
        padding: 10px 12px;
        border-radius: var(--rz-r-card);
        background: rgba(22, 18, 15, 0.96);
        backdrop-filter: blur(20px);
        border: 1px solid var(--rz-line-strong);
        box-shadow: var(--rz-shadow-pop);
        display: grid;
        gap: 6px;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s;
        pointer-events: none;
      }

      .rz-sb-legend-wrap:hover .rz-sb-tooltip,
      .rz-sb-legend-btn:focus-visible + .rz-sb-tooltip {
        opacity: 1;
        visibility: visible;
        transform: translateX(-50%) translateY(0);
      }

      .rz-sb-tip-title {
        font-family: var(--rz-font-ui);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 1.4px;
        text-transform: uppercase;
        color: var(--rz-text-faint);
      }

      .rz-sb-tip-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: var(--rz-text-3);
      }

      .rz-sb-tip-row b {
        font-weight: 500;
        color: var(--rz-text-2);
        min-width: 34px;
      }

      /* Tabular figures plus a reserved width: a coordinate gaining a digit
         used to nudge everything after it along the bar. */
      .rz-sb-cursor,
      .rz-sb-zoom,
      .rz-sb-time {
        font-variant-numeric: tabular-nums;
      }

      .rz-sb-zoom {
        display: inline-block;
        min-width: 34px;
      }

      .rz-sb-cursor {
        min-width: 128px;
      }

      .rz-sb-nodes {
        min-width: 116px;
        justify-content: flex-end;
      }

      .rz-sb-selection {
        min-width: 74px;
      }

      /* Selection is the one readout that appears and disappears, so it gets the
         accent — it is news when it is there. */
      .rz-sb-selection {
        color: var(--rz-accent);
      }

      .rz-sb-selection[hidden] {
        display: none;
      }

      .rz-sb-transport svg {
        fill: var(--rz-text-faint);
      }

      .rz-sb-transport.is-playing svg {
        fill: var(--rz-accent);
      }

      .rz-sb-transport.is-playing .rz-sb-time {
        color: var(--rz-text-2);
      }

      /* The status message is NOT laid out here — see src/ui/StatusToast.js.
         A message of unpredictable length in a fixed row can only be a box too
         wide for its usual content or one that shoves its neighbours; it floats
         above the bar instead. */
      /* The frame-rate readout lives here (src/ui/FpsMeter.js). The status
         message does not: it stays at the right of the menu bar, where it has
         empty space to grow into and nothing to its right to displace. */
      .rz-sb-fps-slot {
        display: flex;
        align-items: center;
        pointer-events: auto;
      }
    `;
    document.head.appendChild(style);
  }
}
