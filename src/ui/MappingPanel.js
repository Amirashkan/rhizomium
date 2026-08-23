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
// A surface can also be given its OWN SOURCE: drag a node out of the graph and drop
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

import {
  MappingModel, CORNERS, rectQuad, MAX_MASK_POINTS, MASK_PRESET_NAMES, pointInQuad,
} from '../mapping/MappingModel.js';
import { MappingCompositor, surfaceMatrices } from '../mapping/MappingCompositor.js';
import { applyMat3 } from '../mapping/homography.js';
import { makeDraggable } from './utils/draggable.js';
import { getOutputAspect } from './OutputFormat.js';
import { registerNodeDropZone } from './NodeReferenceDrop.js';
import {
  findProjectionMapNode,
  ensureProjectionMapNode,
  assignSurfaceSource,
  getSurfaceSource,
  syncMappingToNode,
  syncGuidesToNode,
  trimSurfacePins,
  sourceLabel,
} from '../mapping/projectionMapNode.js';

/** How far past the output frame the stage shows, as a fraction of the frame. */
const VIEW_PAD = 0.1;
/** Zoom limits. Past these the frame is either a speck or unnavigable. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
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

/** Inverse of a row-major 3x3, or null when it has collapsed. */
function invertUnitMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
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
    /**
     * Which gesture the stage is in.
     *   warp — drag corners and surfaces (the default)
     *   draw — place a new surface by clicking its four corners
     *   pan  — drag the view itself
     *   mask — add and move the points of a surface's mask polygon
     * Panning is also always available on the middle button, so a mapping can
     * be nudged around without leaving the tool you are working in.
     */
    this.tool = 'warp';
    /** Show the stage's picture. Off leaves the editing guides on their own. */
    this.showPreview = true;
    /** Show the editing guides: outlines, handles, points, labels, the frame. */
    this.showGuides = true;
    /** Stage view: a zoom about the frame's centre plus a pixel offset. */
    this.view = { scale: 1, x: 0, y: 0 };
    /** Corners placed so far in the draw tool, and the live pointer for the rubber band. */
    this._drawPoints = [];
    this._drawCursor = null;
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
    this._identityModel.addSurface({ name: 'unwarped', dst: rectQuad(0, 0, 1, 1) });
    // Nothing at all: used to clear the stage to an empty frame.
    this._emptyModel = new MappingModel();

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
        <div class="rz-map-segment" role="group" aria-label="Tool">
          <button data-act="tool" data-tool="warp" aria-pressed="true" title="Drag corners and surfaces">Warp</button>
          <button data-act="tool" data-tool="draw" aria-pressed="false" title="Click four corners to place a surface">Draw</button>
          <button data-act="tool" data-tool="pan" aria-pressed="false" title="Drag the view (or hold the middle button in any tool)">Pan</button>
          <button data-act="tool" data-tool="mask" aria-pressed="false" title="Add and move mask points on the selected surface">Mask</button>
        </div>
        <button class="rz-map-btn" data-act="fit" title="Reset zoom and pan">Fit</button>
        <button class="rz-map-toggle" data-act="preview" aria-pressed="true"
                title="Show the picture on this stage (the editor only)">Preview</button>
        <button class="rz-map-toggle" data-act="guides" aria-pressed="true"
                title="Show the setup visuals — on the stage and on the projected output">Guides</button>
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
    this.overlay.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    // Otherwise the ghost point stays where the pointer left the stage.
    this.overlay.addEventListener('pointerleave', () => {
      this._drawCursor = null;
      this._pushGuides();
    });
    // A middle-drag must not paste on Linux or autoscroll on Windows.
    this.overlay.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
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

  /** The source feeding a surface, as { id, label }, or null. */
  _sourceFor(surfaceIndex) {
    const sourceId = getSurfaceSource(this._node(), surfaceIndex);
    if (!sourceId) return null;
    const source = this._graph()?.nodes?.find((n) => String(n.id) === sourceId);
    return { id: sourceId, label: source ? sourceLabel(source) : `node ${sourceId}` };
  }

  /** Wire (or clear) a surface's own source and rebuild the shader. */
  _setSource(surfaceIndex, sourceNodeId) {
    const graph = this._graph();
    if (!graph) return false;
    // Clearing needs no node; assigning brings one into existence.
    const node = sourceNodeId === null
      ? this._node()
      : ensureProjectionMapNode(graph);
    if (!node) return false;

    const previousId = getSurfaceSource(node, surfaceIndex);
    if (!assignSurfaceSource(graph, node, surfaceIndex, sourceNodeId)) return false;

    // Hand the node the geometry it was just created for. The model has not
    // CHANGED here — the surfaces already existed — so the change listener that
    // normally syncs it never fires, and every surface would sit at the default
    // identity matrix: each one covering the whole frame, so the last drawn wins
    // and the mapping only appears once a corner is dragged.
    syncMappingToNode(this.model, node);

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
      editor?.markDirty?.('mapping-source-changed');
      editor?.draw?.();
    } catch { /* ignore */ }
  }

  /**
   * Run an edit that moves surfaces around the list, carrying each surface's
   * SOURCE with it.
   *
   * A source is held on the node's pin for the surface's POSITION. Anything that
   * reorders or removes a surface — send back, bring forward, delete, duplicate
   * — would otherwise leave the sources sitting where they were and hand every
   * surface its neighbour's texture.
   *
   * @param {() => (Object<string,string>|void)} mutate performs the edit; may
   *   return { newSurfaceId: inheritFromSurfaceId } so a duplicate keeps the
   *   source of the surface it was copied from
   */
  _preservingSources(mutate) {
    const node = this._node();
    if (!node) { mutate(); return; }
    const graph = this._graph();

    const sourceById = new Map();
    this.model.surfaces.forEach((surface, i) => {
      sourceById.set(surface.id, getSurfaceSource(node, i));
    });

    const inherit = mutate() || null;
    if (inherit) {
      for (const [newId, fromId] of Object.entries(inherit)) {
        sourceById.set(newId, sourceById.get(fromId) ?? null);
      }
    }

    const surfaces = this.model.surfaces;
    let changed = false;
    for (let i = 0; i < surfaces.length; i++) {
      const want = sourceById.get(surfaces[i].id) ?? null;
      if (assignSurfaceSource(graph, node, i, want)) changed = true;
    }
    if (trimSurfacePins(graph, node, surfaces.length)) changed = true;

    if (changed) {
      syncMappingToNode(this.model, node);
      if (typeof window !== 'undefined' && typeof window.rebuild === 'function') {
        window.rebuild();
      }
      this._afterWiring(graph, node, 0, null, null);
    }
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
      drop: (hit, nodeId) => { this._setSource(hit.index, nodeId); },
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
    const w = (sw / span) * this.view.scale;
    const h = (sh / span) * this.view.scale;
    return {
      x: (sw - w) / 2 + this.view.x,
      y: (sh - h) / 2 + this.view.y,
      w, h, sw, sh,
    };
  }

  /** Reset the view so the whole frame is in sight. */
  _fitView() {
    this.view = { scale: 1, x: 0, y: 0 };
  }

  /**
   * Zoom about a point on the stage, keeping whatever is under it in place —
   * otherwise the corner being aligned slides out from under the cursor.
   */
  _zoomAt(stageX, stageY, factor) {
    const anchor = this._toNormalized(stageX, stageY);
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.scale * factor));
    if (next === this.view.scale) return;
    this.view.scale = next;
    const moved = this._toScreen(anchor.x, anchor.y);
    this.view.x += stageX - moved.x;
    this.view.y += stageY - moved.y;
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
    const p = this._pointerToStage(e);
    return this._toNormalized(p.x, p.y);
  }

  /** Pointer position in stage pixels. */
  _pointerToStage(e) {
    const rect = this.overlay.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /**
   * Output space -> the selected surface's own unit square, which is the space
   * its mask points live in so the mask follows the quad when a corner moves.
   * @returns {{x:number,y:number}|null} null when the quad has collapsed
   */
  _toSurfaceUnit(surface, x, y) {
    const matrices = surfaceMatrices(surface);
    if (!matrices) return null;
    return applyMat3(matrices.dstToUnit, x, y);
  }

  /** The selected surface's unit square -> output space. */
  _fromSurfaceUnit(surface, x, y) {
    const matrices = surfaceMatrices(surface);
    if (!matrices) return null;
    const unitToDst = invertUnitMatrix(matrices.dstToUnit);
    return unitToDst ? applyMat3(unitToDst, x, y) : null;
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
      const source = this.showPreview ? this.getSource() : null;
      if (!this.showPreview) {
        compositor.render(null, this._emptyModel, { frame });
      } else if (this.editMode === 'src' || this._node()) {
        // Source-crop mode wants the composition flat. So does any mapping that
        // has a node: the node IS the mapping, so warping here would either map
        // a mapping (once it drives the output) or invent content for surfaces —
        // showing the composition on a surface whose source is something else.
        // Flat, with handles over it, tells the truth in both cases.
        compositor.render(source, this._identityModel, { frame });
      } else if (this.testPattern) {
        compositor.render(source, this.model, { frame, testPattern: true });
      } else {
        // Nothing has a source yet, so there is nothing to show. Painting the
        // composition here would put a picture on the stage that no surface was
        // assigned — it reads as a texture that came from nowhere. Clear to the
        // frame and let the outlines say where the surfaces are; the alignment
        // grid is there for anyone who wants shapes to aim with first.
        compositor.render(null, this._emptyModel, { frame });
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

    // Guides off: the stage shows the mapping and nothing else, which is how
    // you judge an alignment without handles sitting on top of it.
    if (!this.showGuides) return;

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
    if (this.tool === 'draw') {
      this._drawPending(ctx);
    } else if (!this.model.surfaces.length && this.tool !== 'draw') {
      this._drawMessage(ctx, f, 'Add a surface to start mapping');
    } else if (!this.model.surfaces.length) {
      this._drawMessage(ctx, f, 'Click round the object to draw a surface');
    }
  }

  /**
   * The points placed so far, a rubber band out to the cursor, and a ghost of
   * the point the next click would place — including before the first one, so
   * the tool shows where it is aiming from the moment it is picked up.
   */
  _drawPending(ctx) {
    const pts = this._drawPoints.map((p) => this._toScreen(p.x, p.y));
    ctx.save();
    ctx.strokeStyle = '#c6f24e';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);

    if (pts.length) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (this._drawCursor) {
        const cursor = this._toScreen(this._drawCursor.x, this._drawCursor.y);
        ctx.lineTo(cursor.x, cursor.y);
        // Close back to the start once three are down, so the shape being made
        // is readable before the last click commits it.
        if (pts.length >= 3) ctx.lineTo(pts[0].x, pts[0].y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Where the next click would put a point, so it can be placed against the
    // object rather than guessed at and then dragged.
    if (this._drawCursor) {
      const cursor = this._toScreen(this._drawCursor.x, this._drawCursor.y);
      ctx.beginPath();
      ctx.rect(cursor.x - 4, cursor.y - 4, 8, 8);
      ctx.fillStyle = 'rgba(198, 242, 78, 0.35)';
      ctx.fill();
      ctx.strokeStyle = '#c6f24e';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Ring the first point once the outline can be closed on it.
    if (pts.length >= 3) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#c6f24e';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (let i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.rect(pts[i].x - 4, pts[i].y - 4, 8, 8);
      ctx.fillStyle = '#c6f24e';
      ctx.fill();
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255, 244, 230, 0.8)';
      ctx.textAlign = 'center';
      // Four points become a quad, so name them as corners; otherwise number
      // them, since the shape is an outline rather than a corner pin.
      const label = this._drawPoints.length === 4 ? CORNERS[i] : String(i + 1);
      ctx.fillText(label, pts[i].x, pts[i].y - 9);
    }
    ctx.restore();
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

    // The source this surface is showing, so the rig is readable at a glance.
    const source = this._sourceFor(index);
    if (source) {
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255, 244, 230, 0.6)';
      ctx.fillText(source.label, cx, cy + 13);
    }

    // The mask, in the surface's own space, drawn as the shape the surface is
    // actually cut to.
    const mask = surface.mask || [];
    if (mask.length >= 3) {
      const maskPts = [];
      for (const p of mask) {
        const out = this._fromSurfaceUnit(surface, p.x, p.y);
        if (out) maskPts.push(this._toScreen(out.x, out.y));
      }
      if (maskPts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(maskPts[0].x, maskPts[0].y);
        for (let i = 1; i < maskPts.length; i++) ctx.lineTo(maskPts[i].x, maskPts[i].y);
        ctx.closePath();
        ctx.setLineDash([5, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.setLineDash([]);
        // While masking, show every surface's points, not just the selected
        // one's — an unselected surface's mask is editable by clicking it, so it
        // has to look editable.
        // Shown in warp as well as mask: they are draggable in both, so they
        // have to look it in both.
        if (this.tool === 'mask' || this.tool === 'warp') {
          for (const p of maskPts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, isSelected ? 4 : 3, 0, Math.PI * 2);
            ctx.globalAlpha = isSelected ? 1 : 0.5;
            ctx.fillStyle = color;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#141110';
            ctx.stroke();
            ctx.globalAlpha = dim ? 0.35 : 1;
          }
        }
      }
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
    // Panning is available on the middle button whatever tool is selected, so
    // the view can be nudged without leaving the gesture you are working in.
    if (e.button === 1 || (e.button === 0 && this.tool === 'pan')) {
      this.stage.focus();
      this._beginDrag(e, { kind: 'pan', last: this._pointerToStage(e) });
      return;
    }
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

    if (this.tool === 'draw') {
      this._onDrawPointerDown(e, pt);
      return;
    }

    if (this.tool === 'mask') {
      this._onMaskPointerDown(e, pt);
      return;
    }

    const hitCorner = this.model.hitTestCorner(pt.x, pt.y, tolerance, space);
    if (hitCorner) {
      this.model.select(hitCorner.surfaceId);
      this.activeCorner = hitCorner.corner;
      this._beginDrag(e, { kind: 'corner', surfaceId: hitCorner.surfaceId, corner: hitCorner.corner, space });
      return;
    }

    // The points a surface was DRAWN with are part of its shape, so they are
    // draggable here too. Without this the only editable thing is the quad that
    // bounds the shape — you can move the box around your outline but not the
    // outline itself, which is not what anyone means by editing a surface.
    if (space === 'dst') {
      const shapeHit = this._maskPointOnAnySurface(pt);
      if (shapeHit) {
        this.model.select(shapeHit.surface.id);
        this.activeCorner = null;
        this._grabMaskPoint(e, shapeHit.surface, shapeHit.index);
        return;
      }
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

  /**
   * Draw a surface by placing its outline, one click per point.
   *
   * A surface's WARP is always four-cornered — that is what a homography is —
   * but its SHAPE need not be. Four points are taken as the quad itself, which
   * keeps the familiar corner-pin with four draggable handles. Any other count
   * becomes the quad that bounds the outline, with the outline itself as the
   * surface's mask: the shape is what was drawn, and the four corners are still
   * there to keystone it with.
   *
   * Close with Enter, a double-click, or a click back on the first point.
   */
  _onDrawPointerDown(e, pt) {
    e.preventDefault();

    // Clicking the first point again closes the outline, the way a pen tool does.
    if (this._drawPoints.length >= 3) {
      const first = this._toScreen(this._drawPoints[0].x, this._drawPoints[0].y);
      const here = this._toScreen(pt.x, pt.y);
      if (Math.hypot(first.x - here.x, first.y - here.y) <= GRAB_PX) {
        this._commitDraw();
        return;
      }
    }

    if (this._drawPoints.length >= MAX_MASK_POINTS) {
      this._status(`An outline holds at most ${MAX_MASK_POINTS} points`, 'error');
      return;
    }
    this._drawPoints.push({ x: pt.x, y: pt.y });
    this._pushGuides();
    this._updateHint();
  }

  /**
   * Turn the placed points into a surface.
   * @returns {boolean} whether one was made
   */
  _commitDraw() {
    const points = this._drawPoints;
    if (points.length < 3) {
      this._status('An outline needs at least three points', 'error');
      return false;
    }

    const drawn = points.slice();
    this._drawPoints = [];
    this._pushGuides();

    // Four points ARE the quad: keep the plain corner-pin rather than wrapping
    // them in a bounding box and a mask that says the same thing.
    if (drawn.length === 4) {
      const surface = this.model.addSurface({ dst: drawn });
      if (!surfaceMatrices(surface)) {
        this.model.removeSurface(surface.id);
        this._status('Those corners do not make a shape — try again', 'error');
        return false;
      }
      this._status('Surface drawn');
      this._updateHint();
      return true;
    }

    const xs = drawn.map((p) => p.x);
    const ys = drawn.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX;
    const h = maxY - minY;
    if (!(w > 1e-4 && h > 1e-4)) {
      this._status('Those points lie in a line — try again', 'error');
      this._updateHint();
      return false;
    }

    // The mask is the outline in the quad's own space, so it keystones with the
    // surface when the corners are later dragged onto the object.
    const surface = this.model.addSurface({
      dst: rectQuad(minX, minY, w, h),
      mask: drawn.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h })),
    });
    this._maskChanged();
    this._status(`Surface drawn — ${drawn.length} points`);
    this._updateHint();
    return !!surface;
  }

  /** Abandon a half-drawn outline. */
  _cancelDraw() {
    if (!this._drawPoints.length) return false;
    this._drawPoints = [];
    this._pushGuides();
    this._updateHint();
    return true;
  }

  /**
   * Mask editing.
   *
   * Priority matters here. Editing the surface you are working on has to stay
   * fluid, but the other surfaces' masks have to be reachable too — otherwise
   * the only way to edit one is to find it in the list first, and a click
   * meant for it silently adds a point to whatever happens to be selected.
   *
   *   1. a point of the selected surface  → grab it (or Alt-click to remove)
   *   2. a point of any other surface     → select that surface and grab it
   *   3. inside the selected surface      → add a point
   *   4. inside any other surface         → select it, ready to edit
   */
  _onMaskPointerDown(e, pt) {
    const selected = this.model.getSelected();

    const pointHit = this._maskPointOnAnySurface(pt);
    if (pointHit) {
      this.model.select(pointHit.surface.id);
      this._grabMaskPoint(e, pointHit.surface, pointHit.index);
      return;
    }

    if (selected && pointInQuad(selected.dst, pt.x, pt.y)) {
      this._addMaskPoint(e, selected, pt);
      return;
    }

    const under = this.model.hitTestSurface(pt.x, pt.y);
    if (under) {
      // Select it rather than editing it blind; the next click edits its mask.
      this.model.select(under.id);
      this._status(`Editing ${under.name}`);
      return;
    }

    if (!selected) this._status('Select a surface to mask', 'error');
  }

  /**
   * The mask point under a position on any surface, selected one first so the
   * surface being worked on keeps priority where shapes overlap.
   * @returns {{surface: object, index: number}|null}
   */
  _maskPointOnAnySurface(pt) {
    const selected = this.model.getSelected();
    if (selected && !selected.locked) {
      const hit = this._maskPointAt(selected, pt);
      if (hit >= 0) return { surface: selected, index: hit };
    }
    for (let i = this.model.surfaces.length - 1; i >= 0; i--) {
      const surface = this.model.surfaces[i];
      if (surface.locked) continue;
      if (selected && surface.id === selected.id) continue;
      const hit = this._maskPointAt(surface, pt);
      if (hit >= 0) return { surface, index: hit };
    }
    return null;
  }

  /**
   * The mask point of `surface` under a point in output space, or -1.
   *
   * The grab radius is in stage pixels but a mask lives in the surface's own
   * unit space, so the tolerance has to be converted per surface: a small
   * surface means a large tolerance in its own coordinates.
   */
  _maskPointAt(surface, pt) {
    if (!(surface.mask || []).length) return -1;
    const unit = this._toSurfaceUnit(surface, pt.x, pt.y);
    if (!unit) return -1;
    const f = this._frameRect();
    const edge = this._toSurfaceUnit(surface, pt.x + GRAB_PX / Math.max(1, f.w), pt.y);
    const tolerance = edge ? Math.max(0.01, Math.abs(edge.x - unit.x)) : 0.04;
    return this.model.hitTestMaskPoint(surface.id, unit.x, unit.y, tolerance);
  }

  /** Start moving a mask point, or remove it on an Alt-click. */
  _grabMaskPoint(e, surface, index) {
    if (e.altKey) {
      this.model.removeMaskPoint(surface.id, index);
      this._maskChanged();
      e.preventDefault();
      return;
    }
    this._beginDrag(e, { kind: 'mask', surfaceId: surface.id, point: index });
  }

  /** Add a point to a surface's mask at a position in output space. */
  _addMaskPoint(e, surface, pt) {
    const unit = this._toSurfaceUnit(surface, pt.x, pt.y);
    if (!unit) return;
    if ((surface.mask || []).length >= MAX_MASK_POINTS) {
      this._status(`A mask holds at most ${MAX_MASK_POINTS} points`, 'error');
      return;
    }
    // Insert into the nearest edge rather than appending, so points can be
    // added part-way round a shape instead of only at its end.
    const at = this._nearestMaskEdge(surface, unit);
    if (this.model.addMaskPoint(surface.id, unit.x, unit.y, at) >= 0) this._maskChanged();
    e.preventDefault();
  }

  /**
   * Where a new point belongs: after the vertex whose outgoing edge passes
   * closest to it. Appending blindly makes a shape self-cross as soon as you
   * add a point anywhere but the end.
   * @returns {number} insertion index
   */
  _nearestMaskEdge(surface, unit) {
    const mask = surface.mask || [];
    if (mask.length < 3) return mask.length;

    let best = mask.length;
    let bestDistance = Infinity;
    for (let i = 0; i < mask.length; i++) {
      const a = mask[i];
      const b = mask[(i + 1) % mask.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq > 0
        ? Math.max(0, Math.min(1, ((unit.x - a.x) * dx + (unit.y - a.y) * dy) / lengthSq))
        : 0;
      const distance = Math.hypot(unit.x - (a.x + t * dx), unit.y - (a.y + t * dy));
      if (distance < bestDistance) { bestDistance = distance; best = i + 1; }
    }
    return best;
  }

  /**
   * Push the setup visuals onto the node, so they reach the projector.
   *
   * Everything but the on/off flag is a uniform write, so the outline follows
   * the cursor on the wall without recompiling per click; only toggling the
   * guides themselves changes what the shader contains.
   *
   * @param {{rebuild?: boolean}} [opts] force the rebuild even if nothing looks structural
   */
  _pushGuides(opts = {}) {
    const node = this._node();
    if (!node) return;
    const structural = syncGuidesToNode(node, {
      guides: this.showGuides,
      draft: this.tool === 'draw' ? this._drawPoints : [],
      cursor: this.tool === 'draw' ? this._drawCursor : null,
    });
    if ((structural || opts.rebuild)
        && typeof window !== 'undefined' && typeof window.rebuild === 'function') {
      window.rebuild();
    }
  }

  /** A mask gained or lost a point, which changes the shader's structure. */
  _maskChanged() {
    const node = this._node();
    if (node) {
      syncMappingToNode(this.model, node);
      if (typeof window !== 'undefined' && typeof window.rebuild === 'function') {
        window.rebuild();
      }
    }
  }

  _beginDrag(e, drag) {
    this._drag = drag;
    try { this.overlay.setPointerCapture(e.pointerId); } catch { /* not captured; moves still track */ }
    e.preventDefault();
  }

  _onPointerMove(e) {
    if (this.tool === 'draw') {
      this._drawCursor = this._pointerToNormalized(e);
      // The ghost has to move on the PROJECTOR, which is where a shape is
      // actually being aimed; a uniform write, so this is per-move cheap.
      this._pushGuides();
    }
    const drag = this._drag;
    if (!drag) {
      this._updateCursor(e);
      return;
    }
    if (drag.kind === 'pan') {
      const now = this._pointerToStage(e);
      this.view.x += now.x - drag.last.x;
      this.view.y += now.y - drag.last.y;
      drag.last = now;
      e.preventDefault();
      return;
    }

    const pt = this._pointerToNormalized(e);

    if (drag.kind === 'mask') {
      const surface = this.model.getSurface(drag.surfaceId);
      const unit = surface ? this._toSurfaceUnit(surface, pt.x, pt.y) : null;
      if (unit) this.model.moveMaskPoint(drag.surfaceId, drag.point, unit.x, unit.y);
      e.preventDefault();
      return;
    }

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

  _onWheel(e) {
    e.preventDefault();
    const p = this._pointerToStage(e);
    // A trackpad sends many small deltas and a mouse a few large ones; scaling
    // by the delta rather than a fixed step keeps both feeling the same.
    const factor = Math.exp(-e.deltaY * 0.0015);
    this._zoomAt(p.x, p.y, factor);
  }

  /** Double-clicking empty stage space drops a new surface centred there. */
  _onDoubleClick(e) {
    if (this.tool === 'draw') {
      // The double-click's first press already placed a point; the outline is
      // finished with what is down.
      this._commitDraw();
      e.preventDefault();
      return;
    }
    if (this.editMode !== 'dst') return;
    const pt = this._pointerToNormalized(e);
    if (this.model.hitTestSurface(pt.x, pt.y)) return;
    const half = 0.15;
    this.model.addSurface({ dst: rectQuad(pt.x - half, pt.y - half, half * 2, half * 2) });
    this._status('Surface added');
  }

  _updateCursor(e) {
    if (this.tool === 'pan') {
      if (this.overlay.style.cursor !== 'grab') this.overlay.style.cursor = 'grab';
      return;
    }
    if (this.tool === 'draw') {
      if (this.overlay.style.cursor !== 'crosshair') this.overlay.style.cursor = 'crosshair';
      return;
    }
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
    if (this.tool === 'draw' && (e.key === 'Enter' || e.key === ' ') && this._drawPoints.length) {
      this._commitDraw();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && this._cancelDraw()) {
      this._status('Drawing cancelled');
      e.preventDefault();
      return;
    }
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
      if (this.tool === 'mask' && this.model.clearMask(selected.id)) {
        this._maskChanged();
        this._status('Mask cleared');
      }
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
      case 'tool':
        this._cancelDraw();
        this.tool = button.dataset.tool;
        this.activeCorner = null;
        this._syncToolbar();
        this._updateHint();
        this._pushGuides();
        break;
      case 'fit':
        this._fitView();
        break;
      case 'preview':
        this.showPreview = !this.showPreview;
        this._syncToolbar();
        break;
      case 'guides':
        // Off is how you check the mapping itself, with nothing drawn over it —
        // on the stage AND on the projector, since that is where it is judged.
        this.showGuides = !this.showGuides;
        this._syncToolbar();
        this._pushGuides({ rebuild: true });
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
        this._preservingSources(() => {
          const copy = this.model.duplicateSurface(id);
          // A copy shows what it was copied from; that is what duplicate means.
          return copy ? { [copy.id]: id } : null;
        });
        break;
      case 'remove':
        this._preservingSources(() => { this.model.removeSurface(id); });
        break;
      case 'reset':
        this.model.resetSurface(id);
        break;
      case 'mask-preset':
        if (this.model.applyMaskPreset(id, button.dataset.preset)) {
          this._maskChanged();
          this._buildInspector();
          this._status(`Surface cut to ${button.dataset.preset}`);
        }
        break;
      case 'mask-clear':
        if (this.model.clearMask(id)) {
          this._maskChanged();
          this._buildInspector();
          this._status('Mask cleared');
        }
        break;
      case 'clear-source':
        // The surface falls back to the composition, as an unfed one always has.
        if (this._setSource(Number(button.dataset.index), null)) {
          this._status('Surface source cleared');
        }
        break;
      case 'back':
        this._preservingSources(() => { this.model.reorder(id, -1); });
        break;
      case 'forward':
        this._preservingSources(() => { this.model.reorder(id, 1); });
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
    this.panel.querySelector('[data-act="preview"]').setAttribute('aria-pressed', String(this.showPreview));
    this.panel.querySelector('[data-act="guides"]').setAttribute('aria-pressed', String(this.showGuides));
    for (const button of this.panel.querySelectorAll('[data-act="tool"]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === this.tool));
    }
    for (const button of this.panel.querySelectorAll('[data-act="mode"]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === this.editMode));
    }
  }

  _updateHint() {
    const view = 'Scroll to zoom · middle-drag to pan · <kbd>Fit</kbd> resets';
    if (this.tool === 'pan') {
      this.hintEl.innerHTML = `Dragging the view. ${view}`;
      return;
    }
    if (this.tool === 'draw') {
      const placed = this._drawPoints.length;
      const close = placed >= 3
        ? '<kbd>Enter</kbd>, double-click or click the first point to close'
        : 'at least three points';
      this.hintEl.innerHTML = `Drawing a surface — ${placed} point${placed === 1 ? '' : 's'} placed. `
        + `Click round the object · ${close} · <kbd>Esc</kbd> cancels. `
        + `Four points make a plain quad; any other count keeps the shape you drew. ${view}`;
      return;
    }
    if (this.tool === 'mask') {
      this.hintEl.innerHTML = 'Masking a surface to a shape. '
        + 'Click to add a point · drag one to move it · <kbd>Alt</kbd>-click a point to remove it · '
        + 'click another surface to edit that one instead · '
        + `<kbd>Esc</kbd> clears the mask. ${view}`;
      return;
    }
    const shared = 'Drag a corner to pin it · drag inside to move · <kbd>Shift</kbd> snaps · arrows nudge, <kbd>Tab</kbd> picks a corner';
    this.hintEl.innerHTML = this.editMode === 'src'
      ? `Cropping what the selected surface shows. ${shared} · ${view}`
      : `Pinning surfaces onto the projected frame. Drag a node from the graph onto a surface to give it its own source · double-click empty space to add one. ${shared} · ${view}`;
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
      const source = this._sourceFor(i);
      rows.push(`
        <div class="rz-map-row ${s.id === this.model.selectedId ? 'rz-map-selected' : ''} ${s.enabled ? '' : 'rz-map-off'}"
             data-act="select" data-id="${escapeHtml(s.id)}">
          <span class="rz-map-swatch" style="background:${swatch}"></span>
          <span class="rz-map-row-name">${escapeHtml(s.name)}</span>
          ${source ? `<span class="rz-map-source" title="Showing ${escapeHtml(source.label)}">${escapeHtml(source.label)}</span>` : ''}
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
    const source = this._sourceFor(index);
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
        <label>Source</label>
        ${source
          ? `<span class="rz-map-source-name" title="${escapeHtml(source.label)}">${escapeHtml(source.label)}</span>
             <button class="rz-map-btn" data-act="clear-source" data-index="${index}">Clear</button>`
          : '<span class="rz-map-note">Drag a node here to give this surface its own source</span>'}
      </div>
      <div class="rz-map-field">
        <label>Shape</label>
        <div class="rz-map-shapes">
          <span class="rz-map-note" style="width:100%">${(surface.mask || []).length >= 3
            ? `${surface.mask.length} shape points — drag them on the stage`
            : 'No shape; the whole quad shows'}</span>
          ${MASK_PRESET_NAMES.map((name) => `
            <button class="rz-map-btn" data-act="mask-preset" data-id="${id}" data-preset="${name}"
                    title="Cut this surface to ${name}">${name[0].toUpperCase()}${name.slice(1)}</button>`).join('')}
          ${(surface.mask || []).length >= 3
            ? `<button class="rz-map-btn" data-act="mask-clear" data-id="${id}">None</button>`
            : ''}
        </div>
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
    // Bring the node into existence now rather than on the first source drop.
    // It is what puts the setup visuals on the projector, and drawing onto a
    // complex physical shape means seeing the outline ON the shape from the
    // first click — not after something has already been assigned.
    const graph = this._graph();
    if (graph) {
      const node = ensureProjectionMapNode(graph);
      if (node) {
        syncMappingToNode(this.model, node);
        this._pushGuides({ rebuild: true });
        this._renderList();
        this._buildInspector();
      }
    }
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
