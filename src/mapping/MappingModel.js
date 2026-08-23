// src/mapping/MappingModel.js
//
// The document model behind the projection-mapping tool: an ordered list of
// SURFACES, each pinning a crop of the rendered output onto a quad of the
// projector's field. This is plain data plus edit operations — no DOM, no GL —
// so the editor panel, the second-monitor output and the tests all read the same
// state through one object.
//
// Coordinates are NORMALISED, never pixels. A surface's `dst` corners are in
// output space (0,0 top-left to 1,1 bottom-right of the projector's frame) and
// its `src` corners are the region of the rendered composition to sample. Both
// stay resolution-independent, so a mapping authored against a 1280x720 preview
// still lands correctly when the same project is thrown at 4K.
//
// Corner order is TL, TR, BR, BL — clockwise from the top-left — everywhere.

/** Corner index names, in the order corners are stored. */
export const CORNERS = Object.freeze(['TL', 'TR', 'BR', 'BL']);

/** How far outside the output frame a corner may be dragged. */
const COORD_MIN = -1;
const COORD_MAX = 2;

let _nextSurfaceId = 1;

/** Reset the surface id counter. Used when loading a mapping from a project. */
export function resetSurfaceIdCounter(startFrom = 1) {
  _nextSurfaceId = startFrom;
}

function clampCoord(v, fallback = 0) {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(COORD_MAX, Math.max(COORD_MIN, v));
}

function clamp01(v, fallback = 0) {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

/**
 * A rectangle as a corner quad in TL, TR, BR, BL order.
 * @returns {Array<{x:number,y:number}>}
 */
export function rectQuad(x = 0, y = 0, w = 1, h = 1) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Deep-copy a quad so surfaces never alias each other's corner objects. */
function cloneQuad(quad) {
  return quad.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Coerce arbitrary loaded data into a valid quad, falling back per-corner.
 * @param {*} quad
 * @param {Array<{x:number,y:number}>} fallback
 * @param {(v:number, f:number) => number} clampFn
 */
function sanitizeQuad(quad, fallback, clampFn) {
  if (!Array.isArray(quad) || quad.length !== 4) return cloneQuad(fallback);
  return quad.map((p, i) => ({
    x: clampFn(p && p.x, fallback[i].x),
    y: clampFn(p && p.y, fallback[i].y),
  }));
}

/**
 * Create a surface. Defaults to the whole output showing the whole composition,
 * which is the identity mapping — turning the tool on changes nothing until a
 * corner is actually dragged.
 *
 * @param {object} [opts]
 * @returns {object} a new surface
 */
export function createSurface(opts = {}) {
  const full = rectQuad(0, 0, 1, 1);
  return {
    id: opts.id || `surface-${_nextSurfaceId++}`,
    name: opts.name || `Surface ${_nextSurfaceId - 1}`,
    enabled: opts.enabled !== false,
    locked: opts.locked === true,
    opacity: Number.isFinite(opts.opacity) ? clamp01(opts.opacity, 1) : 1,
    // Feather width as a fraction of the quad, applied inside every edge. Soft
    // edges are what let two projectors overlap without a visible seam.
    softEdge: Number.isFinite(opts.softEdge) ? clamp01(opts.softEdge, 0) : 0,
    dst: sanitizeQuad(opts.dst, full, clampCoord),
    src: sanitizeQuad(opts.src, full, clamp01),
  };
}

/**
 * Point-in-polygon by ray casting, so it stays correct for the concave and
 * self-crossing quads a half-plane test would get wrong.
 *
 * @param {Array<{x:number,y:number}>} quad
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function pointInQuad(quad, x, y) {
  if (!Array.isArray(quad) || quad.length < 3) return false;
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const a = quad[i];
    const b = quad[j];
    const straddles = (a.y > y) !== (b.y > y);
    if (!straddles) continue;
    const crossX = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (x < crossX) inside = !inside;
  }
  return inside;
}

/**
 * Average of a quad's corners — the drag handle for moving a whole surface and
 * the anchor for its on-canvas label.
 * @param {Array<{x:number,y:number}>} quad
 */
export function quadCentroid(quad) {
  let sx = 0;
  let sy = 0;
  for (const p of quad) { sx += p.x; sy += p.y; }
  return { x: sx / quad.length, y: sy / quad.length };
}

/**
 * MappingModel — the ordered surface list plus every edit the UI performs on it.
 *
 * Listeners registered with {@link MappingModel#onChange} fire after any
 * mutation, which is how the editor panel repaints and the second-monitor
 * output picks up a corner drag while it is happening.
 */
export class MappingModel {
  constructor() {
    /** Master bypass. Off means the output renders exactly as it did before. */
    this.enabled = false;
    /** Draw order, back to front. */
    this.surfaces = [];
    /** Id of the surface the editor is acting on, or null. */
    this.selectedId = null;
    this._listeners = new Set();
  }

  /**
   * Subscribe to model changes.
   * @param {Function} fn
   * @returns {Function} unsubscribe
   */
  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Notify listeners. Failures in one listener never stop the others. */
  _emit() {
    for (const fn of this._listeners) {
      try { fn(this); } catch { /* a broken listener must not break editing */ }
    }
  }

  /** @returns {boolean} true when the output should actually be warped. */
  isActive() {
    return this.enabled && this.surfaces.some((s) => s.enabled);
  }

  /** @returns {object|null} */
  getSurface(id) {
    return this.surfaces.find((s) => s.id === id) || null;
  }

  /** @returns {object|null} the selected surface. */
  getSelected() {
    return this.getSurface(this.selectedId);
  }

  select(id) {
    const next = this.getSurface(id) ? id : null;
    if (next === this.selectedId) return;
    this.selectedId = next;
    this._emit();
  }

  /**
   * Add a surface and select it. With no explicit quad, successive surfaces are
   * inset progressively so a second one is visible instead of hiding exactly
   * behind the first.
   *
   * @param {object} [opts]
   * @returns {object} the new surface
   */
  addSurface(opts = {}) {
    // Named for the pin it will feed, not for a global counter. A surface added
    // after another was deleted used to come out as "Surface 3" while sitting on
    // the node's "Surface 1" pin, which makes a rig impossible to read.
    if (!opts.name) {
      opts = { ...opts, name: `Surface ${this.surfaces.length + 1}` };
    }
    if (!opts.dst) {
      const step = Math.min(this.surfaces.length, 6) * 0.06;
      opts = { ...opts, dst: rectQuad(0.05 + step, 0.05 + step, 0.6, 0.6) };
    }
    const surface = createSurface(opts);
    this.surfaces.push(surface);
    this.selectedId = surface.id;
    this._emit();
    return surface;
  }

  /**
   * Remove a surface, selecting its neighbour so the panel is never left with
   * nothing selected while surfaces remain.
   * @returns {boolean} whether anything was removed
   */
  removeSurface(id) {
    const index = this.surfaces.findIndex((s) => s.id === id);
    if (index === -1) return false;
    this.surfaces.splice(index, 1);
    if (this.selectedId === id) {
      const neighbour = this.surfaces[Math.min(index, this.surfaces.length - 1)];
      this.selectedId = neighbour ? neighbour.id : null;
    }
    this._emit();
    return true;
  }

  /**
   * Copy a surface, offset slightly so the duplicate is grabbable.
   * @returns {object|null} the copy
   */
  duplicateSurface(id) {
    const source = this.getSurface(id);
    if (!source) return null;
    const copy = createSurface({
      ...source,
      id: undefined,
      name: `${source.name} copy`,
      dst: source.dst.map((p) => ({ x: p.x + 0.03, y: p.y + 0.03 })),
      src: cloneQuad(source.src),
    });
    this.surfaces.splice(this.surfaces.indexOf(source) + 1, 0, copy);
    this.selectedId = copy.id;
    this._emit();
    return copy;
  }

  /**
   * Patch a surface's scalar fields (name, enabled, locked, opacity, softEdge).
   * Quads go through the corner operations instead.
   * @returns {boolean} whether anything was applied
   */
  updateSurface(id, patch = {}) {
    const surface = this.getSurface(id);
    if (!surface) return false;
    if (typeof patch.name === 'string') surface.name = patch.name;
    if (typeof patch.enabled === 'boolean') surface.enabled = patch.enabled;
    if (typeof patch.locked === 'boolean') surface.locked = patch.locked;
    if (Number.isFinite(patch.opacity)) surface.opacity = clamp01(patch.opacity, surface.opacity);
    if (Number.isFinite(patch.softEdge)) surface.softEdge = clamp01(patch.softEdge, surface.softEdge);
    this._emit();
    return true;
  }

  /**
   * Move one corner to an absolute position. A locked surface ignores this, so
   * an aligned surface can't be nudged out of register by a stray drag.
   *
   * @param {string} id
   * @param {number} corner index 0..3 (see {@link CORNERS})
   * @param {number} x
   * @param {number} y
   * @param {'dst'|'src'} [space]
   * @returns {boolean}
   */
  moveCorner(id, corner, x, y, space = 'dst') {
    const surface = this.getSurface(id);
    if (!surface || surface.locked) return false;
    if (!(corner >= 0 && corner < 4)) return false;
    const quad = space === 'src' ? surface.src : surface.dst;
    const clampFn = space === 'src' ? clamp01 : clampCoord;
    quad[corner] = { x: clampFn(x, quad[corner].x), y: clampFn(y, quad[corner].y) };
    this._emit();
    return true;
  }

  /**
   * Translate a whole surface's destination quad.
   * @returns {boolean}
   */
  moveSurface(id, dx, dy) {
    const surface = this.getSurface(id);
    if (!surface || surface.locked) return false;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    surface.dst = surface.dst.map((p) => ({
      x: clampCoord(p.x + dx, p.x),
      y: clampCoord(p.y + dy, p.y),
    }));
    this._emit();
    return true;
  }

  /**
   * Restore a surface's quads to the full frame, keeping its name and settings.
   * @returns {boolean}
   */
  resetSurface(id) {
    const surface = this.getSurface(id);
    if (!surface || surface.locked) return false;
    surface.dst = rectQuad(0, 0, 1, 1);
    surface.src = rectQuad(0, 0, 1, 1);
    this._emit();
    return true;
  }

  /**
   * Move a surface through the draw order. Positive delta moves it forward.
   * @returns {boolean}
   */
  reorder(id, delta) {
    const from = this.surfaces.findIndex((s) => s.id === id);
    if (from === -1 || !Number.isFinite(delta)) return false;
    const to = Math.min(this.surfaces.length - 1, Math.max(0, from + Math.trunc(delta)));
    if (to === from) return false;
    const [surface] = this.surfaces.splice(from, 1);
    this.surfaces.splice(to, 0, surface);
    this._emit();
    return true;
  }

  setEnabled(on) {
    const next = !!on;
    if (next === this.enabled) return;
    this.enabled = next;
    this._emit();
  }

  /**
   * The corner nearest to a point, within `tolerance`. Searched front-to-back so
   * the topmost surface wins where quads overlap, and locked surfaces are
   * skipped — their handles aren't draggable, so they shouldn't swallow a grab
   * aimed at a surface underneath.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} [tolerance] in normalised units
   * @param {'dst'|'src'} [space]
   * @returns {{surfaceId:string, corner:number, distance:number}|null}
   */
  hitTestCorner(x, y, tolerance = 0.02, space = 'dst') {
    let best = null;
    for (let i = this.surfaces.length - 1; i >= 0; i--) {
      const surface = this.surfaces[i];
      if (surface.locked) continue;
      const quad = space === 'src' ? surface.src : surface.dst;
      for (let c = 0; c < 4; c++) {
        const dx = quad[c].x - x;
        const dy = quad[c].y - y;
        const distance = Math.hypot(dx, dy);
        if (distance > tolerance) continue;
        if (!best || distance < best.distance) {
          best = { surfaceId: surface.id, corner: c, distance };
        }
      }
      // The topmost surface with a corner in range claims the grab; don't let a
      // surface further back steal it just because its corner is a hair closer.
      if (best) return best;
    }
    return best;
  }

  /**
   * The topmost surface containing a point.
   * @returns {object|null}
   */
  hitTestSurface(x, y, space = 'dst') {
    for (let i = this.surfaces.length - 1; i >= 0; i--) {
      const surface = this.surfaces[i];
      const quad = space === 'src' ? surface.src : surface.dst;
      if (pointInQuad(quad, x, y)) return surface;
    }
    return null;
  }

  /** Drop every surface. */
  clear() {
    this.surfaces = [];
    this.selectedId = null;
    this._emit();
  }

  /**
   * Plain-data snapshot for the project file and for broadcasting to the
   * second-monitor window.
   * @returns {{enabled:boolean, surfaces:object[]}}
   */
  serialize() {
    return {
      enabled: this.enabled,
      surfaces: this.surfaces.map((s) => ({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        locked: s.locked,
        opacity: s.opacity,
        softEdge: s.softEdge,
        dst: cloneQuad(s.dst),
        src: cloneQuad(s.src),
      })),
    };
  }

  /**
   * Replace the model's contents from a snapshot. Unknown or malformed fields
   * fall back per-corner rather than rejecting the whole mapping — a project
   * saved by a newer build still opens with whatever this build understands.
   *
   * @param {*} data
   * @returns {boolean} whether a mapping was applied
   */
  deserialize(data) {
    if (!data || typeof data !== 'object') return false;
    const list = Array.isArray(data.surfaces) ? data.surfaces : [];
    this.surfaces = list.map((s) => createSurface(s || {}));
    this.enabled = data.enabled === true;
    this.selectedId = this.surfaces.length ? this.surfaces[0].id : null;

    // Keep generated ids ahead of anything loaded, so a surface added after a
    // load can't collide with one that came out of the file.
    let maxId = 0;
    for (const s of this.surfaces) {
      const match = /^surface-(\d+)$/.exec(s.id);
      if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
    }
    if (maxId >= _nextSurfaceId) _nextSurfaceId = maxId + 1;

    this._emit();
    return true;
  }
}

export default MappingModel;
