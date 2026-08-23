// tests/mappingPanel.test.js
//
// The panel's stage shows a little MORE than the output frame, so a corner can
// be pulled past the frame's edge onto an object that overshoots it. That
// padding sits between every pointer event and the model, which makes the
// coordinate mapping the part most worth pinning down.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MappingPanel } from '../src/ui/MappingPanel.js';
import { MappingModel, rectQuad, resetSurfaceIdCounter } from '../src/mapping/MappingModel.js';

const STAGE_W = 660;
const STAGE_H = 371;

/** Give the stage a real box; happy-dom lays nothing out on its own. */
function sizeStage(panel) {
  Object.defineProperty(panel.stage, 'clientWidth', { value: STAGE_W, configurable: true });
  Object.defineProperty(panel.stage, 'clientHeight', { value: STAGE_H, configurable: true });
  panel.overlay.getBoundingClientRect = () => ({
    left: 0, top: 0, width: STAGE_W, height: STAGE_H,
  });
}

/** A pointer event carrying only what the panel actually reads. */
function pointer(x, y, mods = {}) {
  return {
    button: 0, pointerId: 1, clientX: x, clientY: y,
    shiftKey: false, altKey: false, ...mods,
    preventDefault: vi.fn(),
  };
}

describe('MappingPanel', () => {
  let model;
  let panel;

  beforeEach(() => {
    resetSurfaceIdCounter(1);
    model = new MappingModel();
    panel = new MappingPanel(model, { getSource: () => null });
    sizeStage(panel);
  });

  afterEach(() => {
    panel.dispose();
    vi.restoreAllMocks();
  });

  describe('stage coordinates', () => {
    it('puts the output frame at the centre of the padded stage', () => {
      const f = panel._frameRect();
      expect(f.w).toBeLessThan(STAGE_W);       // padded on both sides
      expect(f.x).toBeCloseTo((STAGE_W - f.w) / 2, 6);
      expect(f.y).toBeCloseTo((STAGE_H - f.h) / 2, 6);
    });

    it('round-trips between normalised and stage space', () => {
      for (const [nx, ny] of [[0, 0], [1, 1], [0.5, 0.5], [-0.2, 1.3]]) {
        const screen = panel._toScreen(nx, ny);
        const back = panel._toNormalized(screen.x, screen.y);
        expect(back.x).toBeCloseTo(nx, 9);
        expect(back.y).toBeCloseTo(ny, 9);
      }
    });

    it('maps the frame corners to 0,0 and 1,1', () => {
      const f = panel._frameRect();
      expect(panel._toNormalized(f.x, f.y)).toEqual({ x: 0, y: 0 });
      const br = panel._toNormalized(f.x + f.w, f.y + f.h);
      expect(br.x).toBeCloseTo(1, 9);
      expect(br.y).toBeCloseTo(1, 9);
    });

    it('reaches past the frame, which is the point of the padding', () => {
      // The very top-left of the stage is outside the projected frame.
      const outside = panel._toNormalized(0, 0);
      expect(outside.x).toBeLessThan(0);
      expect(outside.y).toBeLessThan(0);
    });
  });

  describe('dragging', () => {
    it('grabs a corner, moves it, and releases', () => {
      const surface = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.4, 0.4) });
      const grab = panel._toScreen(0.2, 0.2);

      panel._onPointerDown(pointer(grab.x, grab.y));
      expect(panel._drag).toMatchObject({ kind: 'corner', corner: 0 });
      expect(panel.activeCorner).toBe(0);

      const target = panel._toScreen(0.35, 0.3);
      panel._onPointerMove(pointer(target.x, target.y));
      expect(surface.dst[0].x).toBeCloseTo(0.35, 6);
      expect(surface.dst[0].y).toBeCloseTo(0.3, 6);
      // Only the grabbed corner moves.
      expect(surface.dst[1].x).toBeCloseTo(0.6, 9);
      expect(surface.dst[1].y).toBeCloseTo(0.2, 9);

      panel._onPointerUp(pointer(target.x, target.y));
      expect(panel._drag).toBeNull();
    });

    it('translates the whole surface when the grab lands inside it', () => {
      const surface = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.4, 0.4) });
      const from = panel._toScreen(0.4, 0.4);

      panel._onPointerDown(pointer(from.x, from.y));
      expect(panel._drag).toMatchObject({ kind: 'move' });

      const to = panel._toScreen(0.5, 0.45);
      panel._onPointerMove(pointer(to.x, to.y));
      expect(surface.dst[0].x).toBeCloseTo(0.3, 6);
      expect(surface.dst[0].y).toBeCloseTo(0.25, 6);
      expect(surface.dst[2].x).toBeCloseTo(0.7, 6);
    });

    it('snaps a shift-drag onto the frame edges', () => {
      const surface = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.4, 0.4) });
      const grab = panel._toScreen(0.2, 0.2);
      panel._onPointerDown(pointer(grab.x, grab.y));

      // Just shy of the frame's top-left: without snapping this would sit at
      // 0.008, leaving a hairline of unlit projector along the edge.
      const near = panel._toScreen(0.008, 0.006);
      panel._onPointerMove(pointer(near.x, near.y, { shiftKey: true }));
      expect(surface.dst[0]).toEqual({ x: 0, y: 0 });
    });

    it('selects but does not drag a locked surface', () => {
      const surface = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.4, 0.4) });
      model.updateSurface(surface.id, { locked: true });
      model.select(null);

      const inside = panel._toScreen(0.4, 0.4);
      panel._onPointerDown(pointer(inside.x, inside.y));
      expect(model.selectedId).toBe(surface.id);
      expect(panel._drag).toBeNull();
    });

    it('clears the selection when the grab lands on empty stage', () => {
      const surface = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.2, 0.2) });
      expect(model.selectedId).toBe(surface.id);

      const empty = panel._toScreen(0.9, 0.9);
      panel._onPointerDown(pointer(empty.x, empty.y));
      expect(model.selectedId).toBeNull();
    });

    it('adds a surface on a double-click in empty space', () => {
      panel._onDoubleClick(pointer(...Object.values(panel._toScreen(0.5, 0.5))));
      expect(model.surfaces).toHaveLength(1);
      const centre = model.surfaces[0].dst;
      expect((centre[0].x + centre[2].x) / 2).toBeCloseTo(0.5, 6);
    });
  });

  describe('keyboard', () => {
    let surface;

    beforeEach(() => {
      surface = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.4, 0.4) });
    });

    const key = (k, mods = {}) => ({ key: k, shiftKey: false, altKey: false, ...mods, preventDefault: vi.fn() });

    it('moves the whole surface while no corner is picked', () => {
      panel.activeCorner = null;
      panel._onKeyDown(key('ArrowRight'));
      expect(surface.dst[0].x).toBeCloseTo(0.202, 6);
      expect(surface.dst[1].x).toBeCloseTo(0.602, 6);
    });

    it('nudges the picked corner alone', () => {
      panel.activeCorner = 2;
      panel._onKeyDown(key('ArrowDown'));
      expect(surface.dst[2].y).toBeCloseTo(0.602, 6);
      expect(surface.dst[0].y).toBeCloseTo(0.2, 6);
    });

    it('coarsens with shift and refines with alt', () => {
      panel.activeCorner = 0;
      panel._onKeyDown(key('ArrowRight', { shiftKey: true }));
      expect(surface.dst[0].x).toBeCloseTo(0.22, 6);
      panel._onKeyDown(key('ArrowLeft', { altKey: true }));
      expect(surface.dst[0].x).toBeCloseTo(0.2195, 6);
    });

    it('cycles corners with Tab and drops the pick on Escape', () => {
      panel.activeCorner = null;
      panel._onKeyDown(key('Tab'));
      expect(panel.activeCorner).toBe(0);
      panel._onKeyDown(key('Tab'));
      expect(panel.activeCorner).toBe(1);
      panel._onKeyDown(key('Tab', { shiftKey: true }));
      expect(panel.activeCorner).toBe(0);
      panel._onKeyDown(key('Escape'));
      expect(panel.activeCorner).toBeNull();
    });

    it('ignores keys with nothing selected', () => {
      model.select(null);
      expect(() => panel._onKeyDown(key('ArrowRight'))).not.toThrow();
      expect(surface.dst[0].x).toBe(0.2);
    });
  });

  describe('source-crop mode', () => {
    it('edits the source quad, leaving the surface where it is pinned', () => {
      const surface = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.4, 0.4) });
      panel.editMode = 'src';

      const grab = panel._toScreen(0, 0); // the crop's TL, at the frame's corner
      panel._onPointerDown(pointer(grab.x, grab.y));
      expect(panel._drag).toMatchObject({ kind: 'corner', corner: 0, space: 'src' });

      const to = panel._toScreen(0.25, 0.25);
      panel._onPointerMove(pointer(to.x, to.y));
      expect(surface.src[0].x).toBeCloseTo(0.25, 6);
      expect(surface.dst[0]).toEqual({ x: 0.2, y: 0.2 }); // untouched
    });

    it('does not add surfaces on a double-click while cropping', () => {
      model.addSurface();
      panel.editMode = 'src';
      panel._onDoubleClick(pointer(...Object.values(panel._toScreen(0.9, 0.9))));
      expect(model.surfaces).toHaveLength(1);
    });
  });

  describe('panel controls', () => {
    const click = (act, id) => {
      const el = document.createElement('button');
      el.dataset.act = act;
      if (id) el.dataset.id = id;
      panel.panel.appendChild(el);
      el.click();
      el.remove();
    };

    it('toggles the mapping on and off from the toolbar', () => {
      expect(model.enabled).toBe(false);
      click('enable');
      expect(model.enabled).toBe(true);
      click('enable');
      expect(model.enabled).toBe(false);
    });

    it('switches edit space and clears the picked corner', () => {
      panel.activeCorner = 2;
      const srcBtn = panel.panel.querySelector('[data-act="mode"][data-mode="src"]');
      srcBtn.click();
      expect(panel.editMode).toBe('src');
      expect(panel.activeCorner).toBeNull();
      expect(srcBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('drives add, duplicate, lock and remove from the surface list', () => {
      click('add');
      expect(model.surfaces).toHaveLength(1);
      const id = model.surfaces[0].id;

      click('duplicate', id);
      expect(model.surfaces).toHaveLength(2);

      click('toggle-locked', id);
      expect(model.getSurface(id).locked).toBe(true);

      click('toggle-enabled', id);
      expect(model.getSurface(id).enabled).toBe(false);

      click('remove', id);
      expect(model.getSurface(id)).toBeNull();
    });

    it('lists surfaces front-most first', () => {
      const back = model.addSurface();
      const front = model.addSurface();
      const names = [...panel.listEl.querySelectorAll('.rz-map-row-name')].map((el) => el.textContent);
      expect(names).toEqual([front.name, back.name]);
    });

    it('renames a surface from the inspector', () => {
      const surface = model.addSurface();
      const input = panel.inspectorEl.querySelector('[data-field="name"]');
      input.value = 'Proscenium';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(surface.name).toBe('Proscenium');
    });

    it('writes a corner typed into the inspector', () => {
      const surface = model.addSurface();
      const input = panel.inspectorEl.querySelector('[data-field="corner"][data-corner="2"][data-axis="x"]');
      input.value = '0.42';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(surface.dst[2].x).toBeCloseTo(0.42, 6);
    });

    it('keeps the inspector in step with a stage drag without rebuilding it', () => {
      const surface = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.4, 0.4) });
      const before = panel.inspectorEl.querySelector('[data-field="name"]');

      const grab = panel._toScreen(0.2, 0.2);
      panel._onPointerDown(pointer(grab.x, grab.y));
      const to = panel._toScreen(0.3, 0.25);
      panel._onPointerMove(pointer(to.x, to.y));

      // Same element: a rebuild mid-drag would drop focus out of a field.
      expect(panel.inspectorEl.querySelector('[data-field="name"]')).toBe(before);
      const xField = panel.inspectorEl.querySelector('[data-field="corner"][data-corner="0"][data-axis="x"]');
      expect(Number(xField.value)).toBeCloseTo(0.3, 4);
      expect(surface.dst[0].x).toBeCloseTo(0.3, 6);
    });

    it('shows and hides, and stops the render loop when hidden', () => {
      panel.show();
      expect(panel.isVisible()).toBe(true);
      expect(panel.panel.classList.contains('rz-map-open')).toBe(true);
      panel.hide();
      expect(panel.isVisible()).toBe(false);
      expect(panel._rafId).toBeNull();
    });
  });
});
