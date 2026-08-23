// src/ui/MappingPanel.js
//
// The projection-mapping editor: corner-pin the rendered output onto the
// physical surfaces a projector is aimed at.
//
// The panel's centre is the STAGE — a live, warped view of the composition with
// draggable corner handles over it. It is deliberately the same picture the
// projector shows, drawn by the same {@link MappingCompositor} the output window
// uses, so aligning here is aligning there. The stage view extends a little past
// the output frame (the dashed rectangle) because a surface's corners routinely
// need to be pulled beyond the frame to cover an object that overshoots it.
//
// A surface can also be given its OWN FLOW: drag a node out of the graph and drop
// it on the surface, and that node is wired to the surface's pin on the
// ProjectionMap node. That node is the mapping in the shader, which is how a
// mapping reaches the projector — so once it drives the output, the stage stops
// warping locally and shows the already-mapped render instead, or the warp would
// be applied twice.
//
// Everything the panel edits lives in the shared {@link MappingModel}; the panel
// holds no mapping state of its own. That is what lets the second-monitor
// bridge, the project file and this UI stay in step without any of them knowing
// about the others.

import { MappingModel, CORNERS, rectQuad } from '../mapping/MappingModel.js';
import { MappingCompositor } from '../mapping/MappingCompositor.js';
import { makeDraggable } from './utils/draggable.js';
import { getOutputAspect } from './OutputFormat.js';
import { registerNodeDropZone } from './NodeReferenceDrop.js';
import {
  findProjectionMapNode,
  ensureProjectionMapNode,
  assignSurfaceFlow,
  getSurfaceFlow,
  flowLabel,
} from '../mapping/projectionMapNode.js';

/** How far past the output frame the stage shows, as a fraction of the frame. */
const VIEW_PAD = 0.1;
/** Corner grab radius, in stage pixels. */
const GRAB_PX = 12;
/** Arrow-key nudge, in normalised units. Shift coarsens, Alt refines. */
const NUDGE = 0.002;
const NUDGE_COARSE = 0.02;
const NUDGE_FINE = 0.0005;
/** Shift-drag snaps to this grid, and exactly onto frame edges and centre. */
const SNAP_GRID = 0.05;
const SNAP_ANCHORS = [0, 0.5, 1];
const SNAP_TOLERANCE = 0.02;

/** Matches MappingCompositor's test tints, so the list dot names the surface. */
const SWATCHES = ['#c7f24f', '#59c7ff', '#ff8c52', '#b88cff', '#5cf2b8', '#ffd659'];

function snapValue(v) {
  for (const anchor of SNAP_ANCHORS) {
    if (Math.abs(v - anchor) < SNAP_TOLERANCE) return anchor;
  }
  return Math.round(v / SNAP_GRID) * SNAP_GRID;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export class MappingPanel {
  /**
   * @param {MappingModel} model the shared mapping document
   * @param {object} [opts]
   * @param {() => (CanvasImageSource|null)} [opts.getSource] supplies the frame to
   *   warp; defaults to the editor's main render canvas
   * @param {(msg:string, kind?:string) => void} [opts.onStatus] status-bar sink
   */
  constructor(model, opts = {}) {
    this.model = model || new MappingModel();
    this.getSource = typeof opts.getSource === 'function'
      ? opts.getSource
      : () => document.getElementById('gpu-canvas');
    this.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;

    this.visible = false;
    /** 'dst' pins the surface on the projector; 'src' crops what it shows. */
    this.editMode = 'dst';
    this.testPattern = false;
    /** Corner the arrow keys act on, or null to move the whole surface. */
    this.activeCorner = null;

    this.panel = null;
    this.compositor = null;
    this._rafId = null;
    this._cleanupDraggable = null;
    this._unsubscribe = null;
    this._drag = null;
    this._inspectorFor = null;
    this._unregisterDropZone = null;
    /** Surface index a node drag would land on, while one is in progress. */
    this._dropTarget = null;

    // Editing the source crop needs the composition shown UNWARPED. Rendering an
    // identity surface through the same compositor gives that without a second
    // code path for what is otherwise the same upload-and-draw.
    this._identityModel = new MappingModel();
    this._identityModel.enabled = true;
    this._identityModel.addSurface({ name: 'source', dst: rectQuad(0, 0, 1, 1) });

    this._createPanel();
    this._unsubscribe = this.model.onChange(() => this._onModelChange());
  }

  // --- construction -------------------------------------------------------

  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'mapping-panel';
    panel.innerHTML = `
      <div class="rz-map-header">
        <h3 class="rz-map-title">Projection Mapping</h3>
        <button class="rz-map-close" data-act="close" aria-label="Close">&times;</button>
      </div>

      <div class="rz-map-toolbar">
        <button class="rz-map-toggle" data-act="enable" aria-pressed="false">
          <span data-role="enable-dot">○</span> Mapping
        </button>
        <button class="rz-map-toggle" data-act="test" aria-pressed="false">Test grid</button>
        <span class="rz-map-spacer"></span>
        <div class="rz-map-segment" role="group" aria-label="Edit space">
          <button data-act="mode" data-mode="dst" aria-pressed="true">Output quad</button>
          <button data-act="mode" data-mode="src" aria-pressed="false">Source crop</button>
        </div>
      </div>

      <div class="rz-map-body">
        <div class="rz-map-stage-col">
          <div class="rz-map-stage" tabindex="0" data-role="stage">
            <canvas data-role="gl"></canvas>
            <canvas class="rz-map-overlay" data-role="overlay"></canvas>
          </div>
          <div class="rz-map-hint" data-role="hint"></div>
        </div>

        <div class="rz-map-side">
          <div class="rz-map-section-head">
            <span>Surfaces</span>
            <span class="rz-map-spacer"></span>
            <button class="rz-map-btn rz-map-primary" data-act="add">+ Add</button>
          </div>
          <div class="rz-map-list" data-role="list"></div>
          <div class="rz-map-section-head"><span>Selected surface</span></div>
          <div class="rz-map-inspector" data-role="inspector"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    this.panel = panel;

    this.stage = panel.querySelector('[data-role="stage"]');
    this.glCanvas = panel.querySelector('[data-role="gl"]');
    this.overlay = panel.querySelector('[data-role="overlay"]');
    this.overlayCtx = this.overlay.getContext('2d');
    this.listEl = panel.querySelector('[data-role="list"]');
    this.inspectorEl = panel.querySelector('[data-role="inspector"]');
    this.hintEl = panel.querySelector('[data-role="hint"]');

    this._cleanupDraggable = makeDraggable(panel, panel.querySelector('.rz-map-header'));

    panel.addEventListener('click', (e) => this._onPanelClick(e));
    panel.addEventListener('input', (e) => this._onPanelInput(e));
    panel.addEventListener('change', (e) => this._onPanelInput(e));

    this.overlay.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.overlay.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.overlay.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.overlay.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    this.overlay.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    this.stage.addEventListener('keydown', (e) => this._onKeyDown(e));

    this._syncToolbar();
    this._renderList();
    this._buildInspector();
    this._updateHint();
  }

  /** Lazily build the compositor — a GL context is wasted until first shown. */
  _ensureCompositor() {
    if (this.compositor) return this.compositor;
    this.compositor = new MappingCompositor(this.glCanvas);
    if (!this.compositor.isReady()) {
      this._status('Projection mapping needs WebGL2, which this browser did not provide', 'error');
    }
    return this.compositor;
  }

  // --- the mapping's node ---------------------------------------------------

  /** The editor's graph, or null outside the editor (tests). */
  _graph() {
    if (typeof window === 'undefined') return null;
    return window.editor?.graph || window.graph || null;
  }

  /** The ProjectionMap node standing for this mapping, or null. */
  _node() {
    return findProjectionMapNode(this._graph());
  }

  /**
   * Whether the node is already putting the mapping on screen.
   *
   * When it is, the render the stage samples has been warped ALREADY. Warping it
   * again here would show a mapping of a mapping — so the stage presents it flat
   * and the handles simply sit over it.
   *
   * @returns {boolean}
   */
  _nodeDrivesOutput() {
    const node = this._node();
    if (!node) return false;
    const graph = this._graph();
    const nodes = graph?.nodes;
    if (!Array.isArray(nodes)) return false;
    // Reachability from the output, following inputs back.
    const output = nodes.find((n) => n && n.kind === 'OutputFinal');
    if (!output) return false;
    const seen = new Set();
    const stack = [output];
    while (stack.length) {
      const current = stack.pop();
      if (!current || seen.has(current.id)) continue;
      seen.add(current.id);
      if (current.id === node.id) return true;
      for (const inputId of current.inputs || []) {
        if (inputId === null || inputId === undefined) continue;
        const next = nodes.find((n) => String(n.id) === String(inputId));
        if (next) stack.push(next);
      }
    }
    return false;
  }

  /** The flow feeding a surface, as { id, label }, or null. */
  _flowFor(surfaceIndex) {
    const sourceId = getSurfaceFlow(this._node(), surfaceIndex);
    if (!sourceId) return null;
    const source = this._graph()?.nodes?.find((n) => String(n.id) === sourceId);
    return { id: sourceId, label: source ? flowLabel(source) : `node ${sourceId}` };
  }

  /** Wire (or clear) a surface's own flow and rebuild the shader. */
  _setFlow(surfaceIndex, sourceNodeId) {
    const graph = this._graph();
    if (!graph) return false;
    // Clearing needs no node; assigning brings one into existence.
    const node = sourceNodeId === null
      ? this._node()
      : ensureProjectionMapNode(graph);
    if (!node) return false;

    const previousId = getSurfaceFlow(node, surfaceIndex);
    if (!assignSurfaceFlow(graph, node, surfaceIndex, sourceNodeId)) return false;

    this._afterWiring(graph, node, surfaceIndex, previousId, sourceNodeId);

    // A changed pin changes the shader's structure, so this one does rebuild.
    if (typeof window !== 'undefined' && typeof window.rebuild === 'function') {
      window.rebuild();
    }
    this._renderList();
    this._buildInspector();
    return true;
  }

  /**
   * The editor-side follow-up a wire normally gets.
   *
   * Wiring a surface writes the same state a dragged wire does, but writing it
   * is only half of what ConnectionManager does: it also records the change for
   * undo, invalidates the canvas so the wire is drawn, and regenerates the
   * target's thumbnail. Skipping that left a connection that rendered correctly
   * while the canvas showed no wire and the node kept a stale preview.
   *
   * All of it is guarded — the panel has to work in tests with no editor at all.
   */
  _afterWiring(graph, node, index, previousId, nextId) {
    if (typeof window === 'undefined') return;
    const editor = window.editor;
    const find = (id) => graph.nodes?.find((n) => String(n.id) === String(id)) || null;

    try {
      if (previousId && typeof window.onConnectionDeleted === 'function') {
        window.onConnectionDeleted({
          sourceNode: find(previousId),
          targetNode: node,
          targetInput: index,
          sourceOutput: 0,
        });
      }
      if (nextId && typeof window.onConnectionCreated === 'function') {
        window.onConnectionCreated(String(nextId), node.id, index, 0);
      }
    } catch { /* undo history is not worth failing the drop over */ }

    try {
      editor?.previewIntegration?.generateNodePreview?.(node);
    } catch { /* a stale thumbnail is better than a broken drop */ }

    try {
      editor?.markDirty?.('mapping-flow-changed');
      editor?.draw?.();
    } catch { /* ignore */ }
  }

  /**
   * Offer the surfaces as drop targets for a node dragged out of the graph.
   * Registered only while the panel is open — a hidden panel has nothing on
   * screen to aim at.
   */
  _registerDropZone() {
    if (this._unregisterDropZone) return;
    this._unregisterDropZone = registerNodeDropZone({
      accepts: () => this.visible && this.editMode === 'dst' && this.model.surfaces.length > 0,
      hitTest: (clientX, clientY) => {
        if (!this.visible) return null;
        const rect = this.overlay.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right) return null;
        if (clientY < rect.top || clientY > rect.bottom) return null;
        const pt = this._toNormalized(clientX - rect.left, clientY - rect.top);
        const surface = this.model.hitTestSurface(pt.x, pt.y);
        if (!surface) return null;
        const index = this.model.surfaces.indexOf(surface);
        return index === -1 ? null : { index, surface };
      },
      highlight: (hit) => { this._dropTarget = hit ? hit.index : null; },
      label: (hit) => `→ ${hit.surface.name}`,
      drop: (hit, nodeId) => { this._setFlow(hit.index, nodeId); },
    });
  }

  _unregisterDrop() {
    this._dropTarget = null;
    if (this._unregisterDropZone) {
      this._unregisterDropZone();
      this._unregisterDropZone = null;
    }
  }

  // --- geometry -----------------------------------------------------------

  /**
   * The output frame's rectangle inside the stage, in CSS pixels. The frame is
   * inset by {@link VIEW_PAD} so corners dragged past the frame stay reachable.
   * @returns {{x:number, y:number, w:number, h:number, sw:number, sh:number}}
   */
  _frameRect() {
    const sw = this.stage.clientWidth || 1;
    const sh = this.stage.clientHeight || 1;
    const span = 1 + 2 * VIEW_PAD;
    const w = sw / span;
    const h = sh / span;
    return { x: (sw - w) / 2, y: (sh - h) / 2, w, h, sw, sh };
  }

  /** Normalised output space -> stage CSS pixels. */
  _toScreen(nx, ny) {
    const f = this._frameRect();
    return { x: f.x + nx * f.w, y: f.y + ny * f.h };
  }

  /** Stage CSS pixels -> normalised output space. */
  _toNormalized(px, py) {
    const f = this._frameRect();
    return { x: (px - f.x) / f.w, y: (py - f.y) / f.h };
  }

  _pointerToNormalized(e) {
    const rect = this.overlay.getBoundingClientRect();
    return this._toNormalized(e.clientX - rect.left, e.clientY - rect.top);
  }

  // --- render loop --------------------------------------------------------

  _startLoop() {
    if (this._rafId != null) return;
    const tick = () => {
      this._rafId = requestAnimationFrame(tick);
      this._renderStage();
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._rafId == null) return;
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  /** Keep the stage box at the output's aspect ratio. */
  _sizeStage() {
    const aspect = getOutputAspect() || 16 / 9;
    const width = this.stage.clientWidth || 1;
    const height = Math.round(width / aspect);
    if (this.stage.style.height !== `${height}px`) {
      this.stage.style.height = `${height}px`;
    }
  }

  _renderStage() {
    if (!this.visible) return;
    this._sizeStage();

    const f = this._frameRect();
    if (f.sw <= 0 || f.sh <= 0) return;
    const dpr = window.devicePixelRatio || 1;

    // The GL canvas covers the WHOLE stage, not just the frame, and is told
    // where the frame sits inside it. A corner pinned past the frame then still
    // draws in the padded margin instead of being clipped at the frame's edge —
    // which is exactly the case the padding exists for.
    const frame = { x: f.x / f.sw, y: f.y / f.sh, w: f.w / f.sw, h: f.h / f.sh };

    const compositor = this._ensureCompositor();
    if (compositor.isReady()) {
      compositor.resize(f.sw * dpr, f.sh * dpr);
      const source = this.getSource();
      if (this.editMode === 'src' || this._nodeDrivesOutput()) {
        // Source-crop mode wants the composition flat; and once the node is
        // driving the output the render already carries the mapping, so warping
        // it here would map a mapping.
        compositor.render(source, this._identityModel, { frame });
      } else {
        compositor.render(source, this.model, { frame, testPattern: this.testPattern });
      }
    }

    if (this.overlay.width !== Math.round(f.sw * dpr) || this.overlay.height !== Math.round(f.sh * dpr)) {
      this.overlay.width = Math.round(f.sw * dpr);
      this.overlay.height = Math.round(f.sh * dpr);
    }
    this._drawOverlay(dpr);
  }

  _drawOverlay(dpr) {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const f = this._frameRect();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.sw, f.sh);

    // The output frame: everything inside it reaches the projector.
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 244, 230, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);
    ctx.restore();

    const space = this.editMode;
    const selected = this.model.getSelected();

    if (space === 'src') {
      // Only the selected surface has a crop worth showing; drawing every
      // surface's crop over one unwarped composition is unreadable.
      if (selected) this._drawQuad(ctx, selected.src, selected, true, 0);
      else this._drawMessage(ctx, f, 'Select a surface to crop what it shows');
      return;
    }

    for (let i = 0; i < this.model.surfaces.length; i++) {
      const surface = this.model.surfaces[i];
      this._drawQuad(ctx, surface.dst, surface, surface.id === this.model.selectedId, i);
    }
    if (!this.model.surfaces.length) {
      this._drawMessage(ctx, f, 'Add a surface to start mapping');
    }
  }

  _drawQuad(ctx, quad, surface, isSelected, index) {
    const pts = quad.map((p) => this._toScreen(p.x, p.y));
    const color = SWATCHES[index % SWATCHES.length];
    const dim = !surface.enabled;
    const isDropTarget = this._dropTarget === index;

    ctx.save();
    ctx.globalAlpha = dim ? 0.35 : 1;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeStyle = isSelected ? color : 'rgba(255, 244, 230, 0.45)';
    ctx.stroke();

    if (isDropTarget) {
      // A node is being dragged over this surface — show what a release hits.
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#c6f24e';
      ctx.stroke();
      ctx.fillStyle = 'rgba(198, 242, 78, 0.18)';
      ctx.fill();
      ctx.restore();
    } else if (isSelected) {
      ctx.fillStyle = 'rgba(198, 242, 78, 0.06)';
      ctx.fill();
    }

    // Label at the centroid, offset up so it does not sit under the cursor
    // while the surface is being dragged.
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isSelected ? color : 'rgba(255, 244, 230, 0.55)';
    const label = surface.locked ? `${surface.name} 🔒` : surface.name;
    ctx.fillText(label, cx, cy);

    // The flow this surface is showing, so the rig is readable at a glance.
    const flow = this._flowFor(index);
    if (flow) {
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255, 244, 230, 0.6)';
      ctx.fillText(flow.label, cx, cy + 13);
    }

    if (isSelected && !surface.locked) {
      for (let c = 0; c < pts.length; c++) {
        const p = pts[c];
        const active = this.activeCorner === c;
        const size = active ? 11 : 9;
        ctx.beginPath();
        ctx.rect(p.x - size / 2, p.y - size / 2, size, size);
        ctx.fillStyle = active ? color : '#141110';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.stroke();

        ctx.font = '9px ui-monospace, monospace';
        ctx.fillStyle = 'rgba(255, 244, 230, 0.75)';
        // Push the corner's name outward from the quad's middle so it never
        // covers the handle it names.
        const ox = p.x < cx ? -12 : 12;
        const oy = p.y < cy ? -12 : 12;
        ctx.fillText(CORNERS[c], p.x + ox, p.y + oy);
      }
    }
    ctx.restore();
  }

  _drawMessage(ctx, f, text) {
    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 244, 230, 0.45)';
    ctx.fillText(text, f.x + f.w / 2, f.y + f.h / 2);
    ctx.restore();
  }

  // --- stage interaction --------------------------------------------------

  _onPointerDown(e) {
    if (e.button !== 0) return;
    this.stage.focus();
    const pt = this._pointerToNormalized(e);
    const f = this._frameRect();
    const tolerance = GRAB_PX / Math.max(1, f.w);
    const space = this.editMode;

    if (space === 'src') {
      const selected = this.model.getSelected();
      if (!selected) return;
      for (let c = 0; c < 4; c++) {
        const corner = selected.src[c];
        if (Math.hypot(corner.x - pt.x, corner.y - pt.y) <= tolerance) {
          this._beginDrag(e, { kind: 'corner', surfaceId: selected.id, corner: c, space });
          return;
        }
      }
      return;
    }

    const hitCorner = this.model.hitTestCorner(pt.x, pt.y, tolerance, space);
    if (hitCorner) {
      this.model.select(hitCorner.surfaceId);
      this.activeCorner = hitCorner.corner;
      this._beginDrag(e, { kind: 'corner', surfaceId: hitCorner.surfaceId, corner: hitCorner.corner, space });
      return;
    }

    const hitSurface = this.model.hitTestSurface(pt.x, pt.y, space);
    if (hitSurface) {
      this.model.select(hitSurface.id);
      this.activeCorner = null;
      if (!hitSurface.locked) {
        this._beginDrag(e, { kind: 'move', surfaceId: hitSurface.id, last: pt, space });
      }
      return;
    }

    this.model.select(null);
    this.activeCorner = null;
  }

  _beginDrag(e, drag) {
    this._drag = drag;
    try { this.overlay.setPointerCapture(e.pointerId); } catch { /* not captured; moves still track */ }
    e.preventDefault();
  }

  _onPointerMove(e) {
    const drag = this._drag;
    if (!drag) {
      this._updateCursor(e);
      return;
    }
    const pt = this._pointerToNormalized(e);

    if (drag.kind === 'corner') {
      let { x, y } = pt;
      if (e.shiftKey) { x = snapValue(x); y = snapValue(y); }
      this.model.moveCorner(drag.surfaceId, drag.corner, x, y, drag.space);
    } else if (drag.kind === 'move') {
      this.model.moveSurface(drag.surfaceId, pt.x - drag.last.x, pt.y - drag.last.y);
      drag.last = pt;
    }
    e.preventDefault();
  }

  _onPointerUp(e) {
    if (!this._drag) return;
    this._drag = null;
    try { this.overlay.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }

  /** Double-clicking empty stage space drops a new surface centred there. */
  _onDoubleClick(e) {
    if (this.editMode !== 'dst') return;
    const pt = this._pointerToNormalized(e);
    if (this.model.hitTestSurface(pt.x, pt.y)) return;
    const half = 0.15;
    this.model.addSurface({ dst: rectQuad(pt.x - half, pt.y - half, half * 2, half * 2) });
    this._status('Surface added');
  }

  _updateCursor(e) {
    const pt = this._pointerToNormalized(e);
    const f = this._frameRect();
    const tolerance = GRAB_PX / Math.max(1, f.w);
    let cursor = 'crosshair';
    if (this.editMode === 'src') {
      const selected = this.model.getSelected();
      if (selected && selected.src.some((c) => Math.hypot(c.x - pt.x, c.y - pt.y) <= tolerance)) {
        cursor = 'grab';
      }
    } else if (this.model.hitTestCorner(pt.x, pt.y, tolerance)) {
      cursor = 'grab';
    } else {
      const surface = this.model.hitTestSurface(pt.x, pt.y);
      if (surface) cursor = surface.locked ? 'not-allowed' : 'move';
    }
    if (this.overlay.style.cursor !== cursor) this.overlay.style.cursor = cursor;
  }

  _onKeyDown(e) {
    const selected = this.model.getSelected();
    if (!selected) return;

    if (e.key === 'Tab') {
      // Cycle which corner the arrows act on, so a surface can be aligned from
      // the keyboard alone once the mouse has it roughly in place.
      const next = this.activeCorner == null
        ? 0
        : (this.activeCorner + (e.shiftKey ? 3 : 1)) % 4;
      this.activeCorner = next;
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      this.activeCorner = null;
      e.preventDefault();
      return;
    }

    const deltas = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const delta = deltas[e.key];
    if (!delta) return;

    let step = NUDGE;
    if (e.shiftKey) step = NUDGE_COARSE;
    else if (e.altKey) step = NUDGE_FINE;
    const dx = delta[0] * step;
    const dy = delta[1] * step;

    if (this.activeCorner == null) {
      if (this.editMode === 'dst') this.model.moveSurface(selected.id, dx, dy);
    } else {
      const quad = this.editMode === 'src' ? selected.src : selected.dst;
      const corner = quad[this.activeCorner];
      this.model.moveCorner(
        selected.id, this.activeCorner, corner.x + dx, corner.y + dy, this.editMode,
      );
    }
    e.preventDefault();
  }

  // --- panel controls -----------------------------------------------------

  _onPanelClick(e) {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const act = button.dataset.act;
    const id = button.dataset.id;

    switch (act) {
      case 'close':
        this.hide();
        break;
      case 'enable':
        this.model.setEnabled(!this.model.enabled);
        this._status(this.model.enabled ? 'Projection mapping on' : 'Projection mapping off');
        break;
      case 'test':
        this.testPattern = !this.testPattern;
        this._syncToolbar();
        break;
      case 'mode':
        this.editMode = button.dataset.mode === 'src' ? 'src' : 'dst';
        this.activeCorner = null;
        this._syncToolbar();
        this._updateHint();
        this._buildInspector();
        break;
      case 'add':
        this.model.addSurface();
        this._status('Surface added');
        break;
      case 'select':
        this.model.select(id);
        this.activeCorner = null;
        break;
      case 'toggle-enabled': {
        const surface = this.model.getSurface(id);
        if (surface) this.model.updateSurface(id, { enabled: !surface.enabled });
        break;
      }
      case 'toggle-locked': {
        const surface = this.model.getSurface(id);
        if (surface) this.model.updateSurface(id, { locked: !surface.locked });
        break;
      }
      case 'duplicate':
        this.model.duplicateSurface(id);
        break;
      case 'remove':
        this.model.removeSurface(id);
        break;
      case 'reset':
        this.model.resetSurface(id);
        break;
      case 'clear-flow':
        // The surface falls back to the composition, as an unfed one always has.
        if (this._setFlow(Number(button.dataset.index), null)) {
          this._status('Surface flow cleared');
        }
        break;
      case 'back':
        this.model.reorder(id, -1);
        break;
      case 'forward':
        this.model.reorder(id, 1);
        break;
      default:
        return;
    }
    e.stopPropagation();
  }

  _onPanelInput(e) {
    const field = e.target.closest('[data-field]');
    if (!field) return;
    const id = field.dataset.id;
    const name = field.dataset.field;

    if (name === 'name') {
      this.model.updateSurface(id, { name: field.value });
      return;
    }
    if (name === 'opacity' || name === 'softEdge') {
      this.model.updateSurface(id, { [name]: Number(field.value) });
      return;
    }
    if (name === 'corner') {
      const corner = Number(field.dataset.corner);
      const surface = this.model.getSurface(id);
      if (!surface) return;
      const quad = this.editMode === 'src' ? surface.src : surface.dst;
      const value = Number(field.value);
      if (!Number.isFinite(value)) return;
      const x = field.dataset.axis === 'x' ? value : quad[corner].x;
      const y = field.dataset.axis === 'y' ? value : quad[corner].y;
      this.activeCorner = corner;
      this.model.moveCorner(id, corner, x, y, this.editMode);
    }
  }

  _syncToolbar() {
    const enableBtn = this.panel.querySelector('[data-act="enable"]');
    enableBtn.setAttribute('aria-pressed', String(this.model.enabled));
    enableBtn.querySelector('[data-role="enable-dot"]').textContent = this.model.enabled ? '●' : '○';

    this.panel.querySelector('[data-act="test"]').setAttribute('aria-pressed', String(this.testPattern));
    for (const button of this.panel.querySelectorAll('[data-act="mode"]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === this.editMode));
    }
  }

  _updateHint() {
    const shared = 'Drag a corner to pin it · drag inside to move · <kbd>Shift</kbd> snaps · arrows nudge, <kbd>Tab</kbd> picks a corner';
    this.hintEl.innerHTML = this.editMode === 'src'
      ? `Cropping what the selected surface shows. ${shared}`
      : `Pinning surfaces onto the projected frame. Drag a node from the graph onto a surface to give it its own flow · double-click empty space to add one. ${shared}`;
  }

  _onModelChange() {
    this._syncToolbar();
    this._renderList();
    if (this._inspectorFor !== this.model.selectedId) this._buildInspector();
    else this._syncInspector();
  }

  _renderList() {
    if (!this.model.surfaces.length) {
      this.listEl.innerHTML = '<div class="rz-map-empty">No surfaces yet</div>';
      return;
    }
    // Front-most first: the list reads top-to-bottom the way the surfaces stack.
    const rows = [];
    for (let i = this.model.surfaces.length - 1; i >= 0; i--) {
      const s = this.model.surfaces[i];
      const swatch = SWATCHES[i % SWATCHES.length];
      const flow = this._flowFor(i);
      rows.push(`
        <div class="rz-map-row ${s.id === this.model.selectedId ? 'rz-map-selected' : ''} ${s.enabled ? '' : 'rz-map-off'}"
             data-act="select" data-id="${escapeHtml(s.id)}">
          <span class="rz-map-swatch" style="background:${swatch}"></span>
          <span class="rz-map-row-name">${escapeHtml(s.name)}</span>
          ${flow ? `<span class="rz-map-flow" title="Showing ${escapeHtml(flow.label)}">${escapeHtml(flow.label)}</span>` : ''}
          <button class="rz-map-icon-btn" data-act="toggle-enabled" data-id="${escapeHtml(s.id)}"
                  aria-pressed="${s.enabled}" title="${s.enabled ? 'Hide surface' : 'Show surface'}">${s.enabled ? '◉' : '○'}</button>
          <button class="rz-map-icon-btn" data-act="toggle-locked" data-id="${escapeHtml(s.id)}"
                  aria-pressed="${s.locked}" title="${s.locked ? 'Unlock' : 'Lock'}">${s.locked ? '🔒' : '🔓'}</button>
          <button class="rz-map-icon-btn" data-act="remove" data-id="${escapeHtml(s.id)}" title="Delete surface">✕</button>
        </div>
      `);
    }
    this.listEl.innerHTML = rows.join('');
  }

  _buildInspector() {
    const surface = this.model.getSelected();
    this._inspectorFor = surface ? surface.id : null;
    if (!surface) {
      this.inspectorEl.innerHTML = '<div class="rz-map-empty">Nothing selected</div>';
      return;
    }
    const id = escapeHtml(surface.id);
    const index = this.model.surfaces.indexOf(surface);
    const flow = this._flowFor(index);
    const quad = this.editMode === 'src' ? surface.src : surface.dst;
    const cornerRows = CORNERS.map((label, c) => `
      <span>${label}</span>
      <input type="number" step="0.005" data-field="corner" data-id="${id}" data-corner="${c}" data-axis="x" value="${quad[c].x.toFixed(4)}">
      <input type="number" step="0.005" data-field="corner" data-id="${id}" data-corner="${c}" data-axis="y" value="${quad[c].y.toFixed(4)}">
    `).join('');

    this.inspectorEl.innerHTML = `
      <div class="rz-map-field">
        <label for="rz-map-name">Name</label>
        <input id="rz-map-name" type="text" data-field="name" data-id="${id}" value="${escapeHtml(surface.name)}">
      </div>
      <div class="rz-map-field">
        <label for="rz-map-opacity">Opacity</label>
        <input id="rz-map-opacity" type="range" min="0" max="1" step="0.01" data-field="opacity" data-id="${id}" value="${surface.opacity}">
        <span class="rz-map-value" data-role="opacity-value">${Math.round(surface.opacity * 100)}%</span>
      </div>
      <div class="rz-map-field">
        <label for="rz-map-soft">Soft edge</label>
        <input id="rz-map-soft" type="range" min="0" max="0.5" step="0.005" data-field="softEdge" data-id="${id}" value="${surface.softEdge}">
        <span class="rz-map-value" data-role="soft-value">${Math.round(surface.softEdge * 100)}%</span>
      </div>
      <div class="rz-map-field">
        <label>Flow</label>
        ${flow
          ? `<span class="rz-map-flow-name" title="${escapeHtml(flow.label)}">${escapeHtml(flow.label)}</span>
             <button class="rz-map-btn" data-act="clear-flow" data-index="${index}">Clear</button>`
          : '<span class="rz-map-note">Drag a node here to give this surface its own flow</span>'}
      </div>
      <div class="rz-map-note">
        ${this.editMode === 'src'
          ? 'Corners crop the composition this surface shows (0–1).'
          : 'Corners pin the surface on the projected frame (0–1 is the frame).'}
      </div>
      <div class="rz-map-corner-grid" data-role="corners">
        <span></span><span>x</span><span>y</span>
        ${cornerRows}
      </div>
      <div class="rz-map-actions">
        <button class="rz-map-btn" data-act="reset" data-id="${id}">Reset</button>
        <button class="rz-map-btn" data-act="duplicate" data-id="${id}">Duplicate</button>
        <button class="rz-map-btn" data-act="back" data-id="${id}">Send back</button>
        <button class="rz-map-btn" data-act="forward" data-id="${id}">Bring forward</button>
        <button class="rz-map-btn rz-map-danger" data-act="remove" data-id="${id}">Delete</button>
      </div>
    `;
  }

  /**
   * Push model values back into the inspector's fields. Values are written in
   * place rather than rebuilding the DOM so a drag on the stage updates the
   * numbers without stealing focus from a field being typed into.
   */
  _syncInspector() {
    const surface = this.model.getSelected();
    if (!surface) return;
    const active = document.activeElement;
    const quad = this.editMode === 'src' ? surface.src : surface.dst;

    const setValue = (el, value) => {
      if (!el || el === active) return;
      if (el.value !== value) el.value = value;
    };

    setValue(this.inspectorEl.querySelector('[data-field="name"]'), surface.name);
    setValue(this.inspectorEl.querySelector('[data-field="opacity"]'), String(surface.opacity));
    setValue(this.inspectorEl.querySelector('[data-field="softEdge"]'), String(surface.softEdge));

    const opacityValue = this.inspectorEl.querySelector('[data-role="opacity-value"]');
    if (opacityValue) opacityValue.textContent = `${Math.round(surface.opacity * 100)}%`;
    const softValue = this.inspectorEl.querySelector('[data-role="soft-value"]');
    if (softValue) softValue.textContent = `${Math.round(surface.softEdge * 100)}%`;

    for (const input of this.inspectorEl.querySelectorAll('[data-field="corner"]')) {
      const corner = Number(input.dataset.corner);
      const value = input.dataset.axis === 'x' ? quad[corner].x : quad[corner].y;
      setValue(input, value.toFixed(4));
    }
  }

  _status(message, kind) {
    if (this.onStatus) this.onStatus(message, kind);
  }

  // --- lifecycle ----------------------------------------------------------

  show() {
    if (this.visible) return;
    this.visible = true;
    this.panel.classList.add('rz-map-open');
    this._sizeStage();
    this._ensureCompositor();
    this._registerDropZone();
    this._startLoop();
    this.stage.focus();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('rz-map-open');
    this._unregisterDrop();
    this._stopLoop();
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible() {
    return this.visible;
  }

  dispose() {
    this._stopLoop();
    this._unregisterDrop();
    if (this._unsubscribe) this._unsubscribe();
    if (this._cleanupDraggable) this._cleanupDraggable();
    if (this.compositor) this.compositor.dispose();
    this.compositor = null;
    if (this.panel && this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
    this.panel = null;
  }
}

let instance = null;

/**
 * Singleton accessor, matching the other tool panels.
 * @param {MappingModel} model
 * @param {object} [opts]
 * @returns {MappingPanel}
 */
export function getMappingPanel(model, opts) {
  if (!instance) instance = new MappingPanel(model, opts);
  return instance;
}

export default MappingPanel;
