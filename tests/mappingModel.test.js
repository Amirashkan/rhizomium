// tests/mappingModel.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MappingModel,
  createSurface,
  pointInQuad,
  quadCentroid,
  rectQuad,
  resetSurfaceIdCounter,
  CORNERS,
} from '../src/mapping/MappingModel.js';

describe('rectQuad', () => {
  it('lays corners out clockwise from the top-left', () => {
    expect(rectQuad(0, 0, 1, 1)).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    ]);
    expect(CORNERS).toEqual(['TL', 'TR', 'BR', 'BL']);
  });
});

describe('createSurface', () => {
  beforeEach(() => resetSurfaceIdCounter(1));

  it('defaults to the identity mapping — the whole frame showing the whole composition', () => {
    const s = createSurface();
    expect(s.dst).toEqual(rectQuad(0, 0, 1, 1));
    expect(s.src).toEqual(rectQuad(0, 0, 1, 1));
    expect(s.enabled).toBe(true);
    expect(s.locked).toBe(false);
    expect(s.opacity).toBe(1);
    expect(s.softEdge).toBe(0);
  });

  it('clamps a source crop into the frame but lets a destination corner overshoot it', () => {
    const s = createSurface({
      src: [{ x: -3, y: 0 }, { x: 9, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      dst: [{ x: -0.4, y: 0 }, { x: 1.3, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    });
    // A crop outside the composition would sample nothing.
    expect(s.src[0].x).toBe(0);
    expect(s.src[1].x).toBe(1);
    // A surface may legitimately extend past the projected frame.
    expect(s.dst[0].x).toBeCloseTo(-0.4);
    expect(s.dst[1].x).toBeCloseTo(1.3);
  });

  it('falls back per-corner on malformed quads instead of rejecting the surface', () => {
    const s = createSurface({ dst: [{ x: 'nope' }, { x: 0.5, y: 0.5 }, null, { x: 0, y: 1 }] });
    expect(s.dst[0]).toEqual({ x: 0, y: 0 });      // fell back to the full frame's TL
    expect(s.dst[1]).toEqual({ x: 0.5, y: 0.5 });  // kept
    expect(s.dst[2]).toEqual({ x: 1, y: 1 });      // fell back to BR
  });

  it('does not alias the default quad between surfaces', () => {
    const a = createSurface();
    const b = createSurface();
    a.dst[0].x = 0.5;
    expect(b.dst[0].x).toBe(0);
  });
});

describe('pointInQuad', () => {
  const square = rectQuad(0, 0, 1, 1);

  it('accepts interior points and rejects exterior ones', () => {
    expect(pointInQuad(square, 0.5, 0.5)).toBe(true);
    expect(pointInQuad(square, 1.5, 0.5)).toBe(false);
    expect(pointInQuad(square, -0.1, 0.5)).toBe(false);
  });

  it('handles a concave quad, which a half-plane test would get wrong', () => {
    // An arrowhead: the notch at (0.5, 0.4) is outside despite being inside the
    // convex hull.
    const arrow = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.4 }, { x: 1, y: 1 }];
    expect(pointInQuad(arrow, 0.5, 0.1)).toBe(true);
    expect(pointInQuad(arrow, 0.2, 0.6)).toBe(false);
  });
});

describe('quadCentroid', () => {
  it('averages the corners', () => {
    expect(quadCentroid(rectQuad(0, 0, 1, 1))).toEqual({ x: 0.5, y: 0.5 });
    expect(quadCentroid(rectQuad(2, 4, 2, 2))).toEqual({ x: 3, y: 5 });
  });
});

describe('MappingModel', () => {
  let model;

  beforeEach(() => {
    resetSurfaceIdCounter(1);
    model = new MappingModel();
  });

  it('starts off, so adding the tool changes nothing until it is switched on', () => {
    expect(model.enabled).toBe(false);
    expect(model.isActive()).toBe(false);
    expect(model.surfaces).toEqual([]);
  });

  it('is inactive while enabled but with every surface hidden', () => {
    const s = model.addSurface();
    model.setEnabled(true);
    expect(model.isActive()).toBe(true);
    model.updateSurface(s.id, { enabled: false });
    expect(model.isActive()).toBe(false);
  });

  it('selects a newly added surface and insets successive ones', () => {
    const first = model.addSurface();
    expect(model.selectedId).toBe(first.id);
    const second = model.addSurface();
    expect(model.selectedId).toBe(second.id);
    // The second must not hide exactly behind the first.
    expect(second.dst[0].x).toBeGreaterThan(first.dst[0].x);
  });

  it('notifies listeners on every mutation and stops after unsubscribe', () => {
    const listener = vi.fn();
    const off = model.onChange(listener);
    const s = model.addSurface();
    expect(listener).toHaveBeenCalledTimes(1);
    model.moveCorner(s.id, 0, 0.25, 0.25);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    model.moveCorner(s.id, 0, 0.3, 0.3);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps editing alive when one listener throws', () => {
    const good = vi.fn();
    model.onChange(() => { throw new Error('boom'); });
    model.onChange(good);
    expect(() => model.addSurface()).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it('moves a corner in the requested space and clamps each space to its own range', () => {
    const s = model.addSurface({ dst: rectQuad(0, 0, 1, 1) });
    model.moveCorner(s.id, 1, 1.4, -0.2, 'dst');
    expect(s.dst[1]).toEqual({ x: 1.4, y: -0.2 });

    model.moveCorner(s.id, 1, 1.4, -0.2, 'src');
    expect(s.src[1]).toEqual({ x: 1, y: 0 });
  });

  it('refuses to move a locked surface', () => {
    const s = model.addSurface({ dst: rectQuad(0, 0, 1, 1) });
    model.updateSurface(s.id, { locked: true });
    expect(model.moveCorner(s.id, 0, 0.5, 0.5)).toBe(false);
    expect(model.moveSurface(s.id, 0.1, 0.1)).toBe(false);
    expect(model.resetSurface(s.id)).toBe(false);
    expect(s.dst[0]).toEqual({ x: 0, y: 0 });
  });

  it('translates every corner of a surface together', () => {
    const s = model.addSurface({ dst: rectQuad(0.1, 0.1, 0.5, 0.5) });
    model.moveSurface(s.id, 0.2, -0.05);
    expect(s.dst[0].x).toBeCloseTo(0.3);
    expect(s.dst[0].y).toBeCloseTo(0.05);
    expect(s.dst[2].x).toBeCloseTo(0.8);
  });

  it('duplicates a surface as an offset copy that shares no corner objects', () => {
    const s = model.addSurface({ dst: rectQuad(0.1, 0.1, 0.4, 0.4) });
    model.updateSurface(s.id, { opacity: 0.5 });
    const copy = model.duplicateSurface(s.id);

    expect(copy.id).not.toBe(s.id);
    expect(copy.name).toBe(`${s.name} copy`);
    expect(copy.opacity).toBe(0.5);
    expect(copy.dst[0].x).toBeCloseTo(0.13);
    copy.dst[0].x = 0.9;
    expect(s.dst[0].x).toBeCloseTo(0.1);
    // Inserted directly above its original in the draw order.
    expect(model.surfaces.indexOf(copy)).toBe(model.surfaces.indexOf(s) + 1);
  });

  it('selects a neighbour when the selected surface is removed', () => {
    const a = model.addSurface();
    const b = model.addSurface();
    model.select(b.id);
    model.removeSurface(b.id);
    expect(model.selectedId).toBe(a.id);
    model.removeSurface(a.id);
    expect(model.selectedId).toBeNull();
  });

  it('reorders within bounds and reports when nothing moved', () => {
    const a = model.addSurface();
    const b = model.addSurface();
    expect(model.reorder(a.id, 1)).toBe(true);
    expect(model.surfaces.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(model.reorder(a.id, 5)).toBe(false); // already front-most
    expect(model.reorder(b.id, -3)).toBe(false); // already back-most
  });

  it('gives the topmost surface the corner grab where quads overlap', () => {
    const back = model.addSurface({ dst: rectQuad(0, 0, 0.5, 0.5) });
    const front = model.addSurface({ dst: rectQuad(0.01, 0.01, 0.5, 0.5) });
    const hit = model.hitTestCorner(0.005, 0.005, 0.05);
    expect(hit.surfaceId).toBe(front.id);
    expect(hit.corner).toBe(0);
    expect(back.id).not.toBe(front.id);
  });

  it('skips locked surfaces when hit-testing corners so the one underneath is grabbable', () => {
    const under = model.addSurface({ dst: rectQuad(0, 0, 0.5, 0.5) });
    const over = model.addSurface({ dst: rectQuad(0.005, 0.005, 0.5, 0.5) });
    model.updateSurface(over.id, { locked: true });
    expect(model.hitTestCorner(0.004, 0.004, 0.05).surfaceId).toBe(under.id);
  });

  it('returns no corner beyond the tolerance', () => {
    model.addSurface({ dst: rectQuad(0, 0, 0.5, 0.5) });
    expect(model.hitTestCorner(0.4, 0.4, 0.02)).toBeNull();
  });

  it('hit-tests surfaces front to back', () => {
    model.addSurface({ dst: rectQuad(0, 0, 1, 1) });
    const front = model.addSurface({ dst: rectQuad(0.4, 0.4, 0.2, 0.2) });
    expect(model.hitTestSurface(0.5, 0.5).id).toBe(front.id);
    expect(model.hitTestSurface(0.05, 0.05).id).not.toBe(front.id);
    expect(model.hitTestSurface(5, 5)).toBeNull();
  });

  it('resets a surface to the full frame without losing its settings', () => {
    const s = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.3, 0.3) });
    model.updateSurface(s.id, { name: 'Pillar', opacity: 0.4 });
    model.resetSurface(s.id);
    expect(s.dst).toEqual(rectQuad(0, 0, 1, 1));
    expect(s.name).toBe('Pillar');
    expect(s.opacity).toBe(0.4);
  });

  it('ignores updates for an unknown surface', () => {
    expect(model.updateSurface('nope', { name: 'x' })).toBe(false);
    expect(model.removeSurface('nope')).toBe(false);
    expect(model.duplicateSurface('nope')).toBeNull();
  });
});

describe('MappingModel serialization', () => {
  beforeEach(() => resetSurfaceIdCounter(1));

  it('round-trips a mapping', () => {
    const model = new MappingModel();
    model.setEnabled(true);
    const s = model.addSurface({ dst: rectQuad(0.1, 0.2, 0.4, 0.4) });
    model.updateSurface(s.id, { name: 'Left wall', opacity: 0.8, softEdge: 0.1, locked: true });
    model.moveCorner(s.id, 2, 0.9, 0.95);

    const restored = new MappingModel();
    restored.deserialize(JSON.parse(JSON.stringify(model.serialize())));

    expect(restored.enabled).toBe(true);
    expect(restored.surfaces).toHaveLength(1);
    const out = restored.surfaces[0];
    expect(out.name).toBe('Left wall');
    expect(out.opacity).toBe(0.8);
    expect(out.softEdge).toBe(0.1);
    expect(out.locked).toBe(true);
    expect(out.dst).toEqual(model.surfaces[0].dst);
  });

  it('does not alias the live model through a snapshot', () => {
    const model = new MappingModel();
    const s = model.addSurface();
    const snapshot = model.serialize();
    snapshot.surfaces[0].dst[0].x = 0.75;
    expect(s.dst[0].x).toBe(0.05);
  });

  it('keeps generated ids clear of loaded ones', () => {
    const model = new MappingModel();
    model.deserialize({ enabled: false, surfaces: [{ id: 'surface-9', name: 'nine' }] });
    const added = model.addSurface();
    expect(added.id).not.toBe('surface-9');
    expect(model.getSurface('surface-9')).not.toBeNull();
  });

  it('tolerates missing and malformed data rather than losing the project', () => {
    const model = new MappingModel();
    expect(model.deserialize(null)).toBe(false);
    expect(model.deserialize(undefined)).toBe(false);

    expect(model.deserialize({})).toBe(true);
    expect(model.surfaces).toEqual([]);
    expect(model.enabled).toBe(false);

    expect(model.deserialize({ enabled: true, surfaces: [null, { dst: 'junk' }] })).toBe(true);
    expect(model.surfaces).toHaveLength(2);
    expect(model.surfaces[1].dst).toEqual(rectQuad(0, 0, 1, 1));
  });

  it('clears every surface', () => {
    const model = new MappingModel();
    model.addSurface();
    model.addSurface();
    model.clear();
    expect(model.surfaces).toEqual([]);
    expect(model.selectedId).toBeNull();
  });
});
