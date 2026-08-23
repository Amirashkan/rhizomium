// tests/mappingPanel.test.js
//
// The panel's stage shows a little MORE than the output frame, so a corner can
// be pulled past the frame's edge onto an object that overshoots it. That
// padding sits between every pointer event and the model, which makes the
// coordinate mapping the part most worth pinning down.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MappingPanel } from '../src/ui/MappingPanel.js';
import {
  MappingModel, rectQuad, resetSurfaceIdCounter, MAX_MASK_POINTS,
} from '../src/mapping/MappingModel.js';
import * as dropModule from '../src/ui/NodeReferenceDrop.js';
import { getInputCount } from '../src/data/nodeInputs.js';

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


  describe('view controls', () => {
    it('starts fitted', () => {
      expect(panel.view).toEqual({ scale: 1, x: 0, y: 0 });
    });

    it('pans the view with a middle-drag whatever tool is selected', () => {
      panel.tool = 'warp';
      const down = { ...pointer(100, 100), button: 1 };
      panel._onPointerDown(down);
      expect(panel._drag).toMatchObject({ kind: 'pan' });

      panel._onPointerMove(pointer(140, 125));
      expect(panel.view.x).toBeCloseTo(40);
      expect(panel.view.y).toBeCloseTo(25);
    });

    it('pans with the left button in the pan tool', () => {
      panel.tool = 'pan';
      panel._onPointerDown(pointer(100, 100));
      expect(panel._drag).toMatchObject({ kind: 'pan' });
    });

    it('keeps whatever is under the cursor in place while zooming', () => {
      // Otherwise the corner being aligned slides out from under the pointer.
      const before = panel._toNormalized(200, 140);
      panel._zoomAt(200, 140, 2);
      const after = panel._toNormalized(200, 140);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
      expect(panel.view.scale).toBe(2);
    });

    it('clamps zoom so the frame stays navigable', () => {
      panel._zoomAt(200, 140, 1000);
      expect(panel.view.scale).toBe(8);
      panel._zoomAt(200, 140, 0.00001);
      expect(panel.view.scale).toBe(0.25);
    });

    it('scales the stage geometry with the zoom', () => {
      const before = panel._frameRect().w;
      panel._zoomAt(200, 140, 2);
      expect(panel._frameRect().w).toBeCloseTo(before * 2, 6);
    });

    it('Fit puts the view back', () => {
      panel._zoomAt(200, 140, 3);
      panel.view.x = 88;
      panel.panel.querySelector('[data-act="fit"]').click();
      expect(panel.view).toEqual({ scale: 1, x: 0, y: 0 });
    });

    it('switches tools from the toolbar', () => {
      const maskBtn = panel.panel.querySelector('[data-act="tool"][data-tool="mask"]');
      maskBtn.click();
      expect(panel.tool).toBe('mask');
      expect(maskBtn.getAttribute('aria-pressed')).toBe('true');
      expect(panel.panel.querySelector('[data-act="tool"][data-tool="warp"]').getAttribute('aria-pressed')).toBe('false');
    });
  });


  describe('draw tool', () => {
    beforeEach(() => {
      panel.tool = 'draw';
      window.graph = { nodes: [{ id: '5', kind: 'Circle', params: {}, inputs: [] }], connections: [] };
      window.rebuild = vi.fn();
    });

    afterEach(() => {
      delete window.graph;
      delete window.rebuild;
    });

    const click = (nx, ny) => {
      const p = panel._toScreen(nx, ny);
      panel._onPointerDown(pointer(p.x, p.y));
    };
    const key = (k) => ({ key: k, shiftKey: false, altKey: false, preventDefault: vi.fn() });

    it('takes four points as the quad itself, with no mask', () => {
      // Four points ARE a homography's corners; wrapping them in a bounding box
      // and a mask that says the same thing would just cost two handles.
      click(0.1, 0.2); click(0.5, 0.1); click(0.5, 0.9); click(0.1, 0.8);
      panel._onKeyDown(key('Enter'));

      expect(model.surfaces).toHaveLength(1);
      const s = model.surfaces[0];
      expect(s.mask).toEqual([]);
      expect(s.dst[0].x).toBeCloseTo(0.1, 4);
      expect(s.dst[1].x).toBeCloseTo(0.5, 4);
    });

    it('keeps the shape drawn when it is not four points', () => {
      click(0.2, 0.1); click(0.8, 0.2); click(0.9, 0.7); click(0.5, 0.9); click(0.1, 0.6);
      panel._onKeyDown(key('Enter'));

      const s = model.surfaces[0];
      expect(s.mask).toHaveLength(5);
      // The quad bounds the outline, so the corners are still there to keystone.
      expect(s.dst[0].x).toBeCloseTo(0.1, 4);
      expect(s.dst[0].y).toBeCloseTo(0.1, 4);
      expect(s.dst[2].x).toBeCloseTo(0.9, 4);
      expect(s.dst[2].y).toBeCloseTo(0.9, 4);
    });

    it('draws a triangle', () => {
      click(0.5, 0.1); click(0.9, 0.9); click(0.1, 0.9);
      panel._onKeyDown(key('Enter'));
      expect(model.surfaces[0].mask).toHaveLength(3);
    });

    it('puts the outline in the quad\'s own space, so it keystones with it', () => {
      click(0.2, 0.2); click(0.6, 0.2); click(0.6, 0.6); click(0.4, 0.8); click(0.2, 0.6);
      panel._onKeyDown(key('Enter'));
      const s = model.surfaces[0];
      // The leftmost/topmost drawn point sits at the quad's own origin.
      expect(s.mask[0].x).toBeCloseTo(0, 4);
      expect(s.mask[0].y).toBeCloseTo(0, 4);
    });

    it('closes on a click back at the first point', () => {
      click(0.2, 0.2); click(0.8, 0.2); click(0.5, 0.8);
      click(0.2, 0.2); // back to the start
      expect(model.surfaces).toHaveLength(1);
      expect(model.surfaces[0].mask).toHaveLength(3);
    });

    it('closes on a double-click', () => {
      click(0.2, 0.2); click(0.8, 0.2); click(0.5, 0.8);
      panel._onDoubleClick(pointer(0, 0));
      expect(model.surfaces).toHaveLength(1);
    });

    it('refuses an outline with too few points', () => {
      const onStatus = vi.fn();
      panel.onStatus = onStatus;
      click(0.2, 0.2); click(0.8, 0.2);
      panel._onKeyDown(key('Enter'));
      expect(model.surfaces).toHaveLength(0);
      expect(onStatus).toHaveBeenCalledWith('An outline needs at least three points', 'error');
    });

    it('refuses points that lie in a line', () => {
      const onStatus = vi.fn();
      panel.onStatus = onStatus;
      click(0.1, 0.5); click(0.4, 0.5); click(0.7, 0.5);
      panel._onKeyDown(key('Enter'));
      expect(model.surfaces).toHaveLength(0);
      expect(onStatus).toHaveBeenCalledWith('Those points lie in a line — try again', 'error');
    });

    it('goes past four points, and up to what the shader can carry', () => {
      for (let i = 0; i < MAX_MASK_POINTS; i++) {
        const a = (i / MAX_MASK_POINTS) * Math.PI * 2;
        click(0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a));
      }
      expect(panel._drawPoints).toHaveLength(MAX_MASK_POINTS);
      const onStatus = vi.fn();
      panel.onStatus = onStatus;
      click(0.99, 0.99);
      expect(panel._drawPoints).toHaveLength(MAX_MASK_POINTS);
      expect(onStatus).toHaveBeenCalledWith(
        `An outline holds at most ${MAX_MASK_POINTS} points`, 'error',
      );
    });

    it('abandons a half-drawn outline on Escape', () => {
      click(0.2, 0.2); click(0.8, 0.2);
      panel._onKeyDown(key('Escape'));
      expect(panel._drawPoints).toEqual([]);
      expect(model.surfaces).toHaveLength(0);
    });

    it('abandons a half-drawn outline when the tool changes', () => {
      click(0.2, 0.2); click(0.8, 0.2);
      panel.panel.querySelector('[data-act="tool"][data-tool="warp"]').click();
      expect(panel._drawPoints).toEqual([]);
    });
  });


  describe('editing drawn points in the warp tool', () => {
    beforeEach(() => {
      window.graph = { nodes: [{ id: '5', kind: 'Circle', params: {}, inputs: [] }], connections: [] };
      window.rebuild = vi.fn();
    });

    afterEach(() => {
      delete window.graph;
      delete window.rebuild;
    });

    /** Draw a five-point shape, leaving it selected. */
    const drawShape = () => {
      panel.tool = 'draw';
      for (const [x, y] of [[0.2, 0.1], [0.8, 0.2], [0.9, 0.7], [0.5, 0.9], [0.1, 0.6]]) {
        const p = panel._toScreen(x, y);
        panel._onPointerDown(pointer(p.x, p.y));
      }
      panel._onKeyDown({ key: 'Enter', shiftKey: false, altKey: false, preventDefault: vi.fn() });
      panel.tool = 'warp';
      return model.surfaces[0];
    };

    it('grabs a drawn point, not just the quad that bounds it', () => {
      // The bug: only the bounding rectangle's corners were grabbable, so you
      // could move the box around your outline but never the outline itself.
      const s = drawShape();
      const p = panel._fromSurfaceUnit(s, s.mask[2].x, s.mask[2].y);
      const at = panel._toScreen(p.x, p.y);
      panel._onPointerDown(pointer(at.x, at.y));
      expect(panel._drag).toMatchObject({ kind: 'mask', surfaceId: s.id, point: 2 });
    });

    it('moves the drawn point it grabbed', () => {
      const s = drawShape();
      const before = { ...s.mask[2] };
      const p = panel._fromSurfaceUnit(s, s.mask[2].x, s.mask[2].y);
      const at = panel._toScreen(p.x, p.y);
      panel._onPointerDown(pointer(at.x, at.y));
      const to = panel._toScreen(p.x - 0.15, p.y - 0.1);
      panel._onPointerMove(pointer(to.x, to.y));
      expect(s.mask[2]).not.toEqual(before);
    });

    it('still grabs a quad corner in preference to a point', () => {
      // The corners are what keystone the surface; they must stay reachable.
      const s = drawShape();
      const at = panel._toScreen(s.dst[0].x, s.dst[0].y);
      panel._onPointerDown(pointer(at.x, at.y));
      expect(panel._drag).toMatchObject({ kind: 'corner', corner: 0 });
    });

    it('still moves the whole surface from inside it', () => {
      const s = drawShape();
      const at = panel._toScreen(0.5, 0.5);
      panel._onPointerDown(pointer(at.x, at.y));
      expect(panel._drag).toMatchObject({ kind: 'move', surfaceId: s.id });
    });

    it('leaves a locked surface\'s points alone', () => {
      const s = drawShape();
      model.updateSurface(s.id, { locked: true });
      const p = panel._fromSurfaceUnit(s, s.mask[2].x, s.mask[2].y);
      const at = panel._toScreen(p.x, p.y);
      panel._onPointerDown(pointer(at.x, at.y));
      expect(panel._drag).toBeNull();
    });
  });

  describe('stage visibility toggles', () => {
    it('starts with the picture and the guides both shown', () => {
      expect(panel.showPreview).toBe(true);
      expect(panel.showGuides).toBe(true);
    });

    it('toggles the picture', () => {
      const btn = panel.panel.querySelector('[data-act="preview"]');
      btn.click();
      expect(panel.showPreview).toBe(false);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      btn.click();
      expect(panel.showPreview).toBe(true);
    });

    it('toggles the guides, which is how a mapping is judged without handles on it', () => {
      const btn = panel.panel.querySelector('[data-act="guides"]');
      btn.click();
      expect(panel.showGuides).toBe(false);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    });

    it('draws no overlay at all with the guides off', () => {
      model.addSurface();
      const calls = [];
      panel.overlayCtx = {
        setTransform() {}, clearRect() { calls.push('clear'); },
        save() { calls.push('save'); }, restore() {}, beginPath() {}, moveTo() {},
        lineTo() {}, closePath() {}, stroke() {}, fill() {}, fillText() {},
        strokeRect() { calls.push('strokeRect'); }, rect() {}, arc() {}, setLineDash() {},
      };
      panel.showGuides = false;
      panel._drawOverlay(1);
      expect(calls).toEqual(['clear']);
    });
  });

  describe('the point about to be placed', () => {
    it('is tracked before the first click, so the tool shows where it aims', () => {
      panel.tool = 'draw';
      const p = panel._toScreen(0.3, 0.4);
      panel._onPointerMove(pointer(p.x, p.y));
      expect(panel._drawCursor.x).toBeCloseTo(0.3, 4);
      expect(panel._drawCursor.y).toBeCloseTo(0.4, 4);
      expect(panel._drawPoints).toEqual([]);
    });

    it('stops showing once the pointer leaves the stage', () => {
      panel.tool = 'draw';
      const p = panel._toScreen(0.3, 0.4);
      panel._onPointerMove(pointer(p.x, p.y));
      panel.overlay.dispatchEvent(new Event('pointerleave'));
      expect(panel._drawCursor).toBeNull();
    });
  });

  describe('mask tool', () => {
    let surface;

    beforeEach(() => {
      surface = model.addSurface({ dst: rectQuad(0, 0, 1, 1) });
      panel.tool = 'mask';
    });

    const clickAt = (nx, ny, mods = {}) => {
      const p = panel._toScreen(nx, ny);
      panel._onPointerDown(pointer(p.x, p.y, mods));
    };

    it('adds a point where the stage was clicked, in the surface\'s own space', () => {
      clickAt(0.25, 0.75);
      expect(surface.mask).toHaveLength(1);
      expect(surface.mask[0].x).toBeCloseTo(0.25, 4);
      expect(surface.mask[0].y).toBeCloseTo(0.75, 4);
    });

    it('keeps mask points relative to the quad, so they follow a corner drag', () => {
      // A mask drawn around a doorway has to stay on the doorway while the
      // surface is being aligned.
      clickAt(0.5, 0.5);
      const recorded = { ...surface.mask[0] };
      model.moveCorner(surface.id, 0, -0.2, -0.2);
      expect(surface.mask[0]).toEqual(recorded);
    });

    it('grabs an existing point instead of adding another on top of it', () => {
      clickAt(0.5, 0.5);
      clickAt(0.5, 0.5);
      expect(surface.mask).toHaveLength(1);
      expect(panel._drag).toMatchObject({ kind: 'mask', point: 0 });
    });

    it('drags a point to a new place', () => {
      clickAt(0.5, 0.5);
      clickAt(0.5, 0.5); // grab it
      const to = panel._toScreen(0.7, 0.35);
      panel._onPointerMove(pointer(to.x, to.y));
      expect(surface.mask[0].x).toBeCloseTo(0.7, 4);
      expect(surface.mask[0].y).toBeCloseTo(0.35, 4);
    });

    it('removes a point on an Alt-click', () => {
      clickAt(0.2, 0.2);
      clickAt(0.8, 0.2);
      clickAt(0.8, 0.8);
      clickAt(0.2, 0.8);
      expect(surface.mask).toHaveLength(4);
      clickAt(0.8, 0.2, { altKey: true });
      expect(surface.mask).toHaveLength(3);
    });

    it('inserts into the nearest edge rather than always appending', () => {
      // Appending blindly makes the shape self-cross as soon as a point is
      // added anywhere but the end.
      clickAt(0.1, 0.1);
      clickAt(0.9, 0.1);
      clickAt(0.9, 0.9);
      clickAt(0.5, 0.02); // sits on the edge between points 0 and 1
      expect(surface.mask[1].x).toBeCloseTo(0.5, 4);
    });

    it('clears the mask on Escape', () => {
      clickAt(0.2, 0.2);
      clickAt(0.8, 0.2);
      clickAt(0.5, 0.8);
      panel._onKeyDown({ key: 'Escape', shiftKey: false, altKey: false, preventDefault: vi.fn() });
      expect(surface.mask).toEqual([]);
    });

    it('selects the surface clicked when none is selected', () => {
      model.select(null);
      clickAt(0.5, 0.5);
      expect(model.selectedId).toBe(surface.id);
      // Selecting is all the first click does; it does not also start a shape.
      expect(surface.mask).toEqual([]);
    });

    it('says so when there is nothing under the click at all', () => {
      const onStatus = vi.fn();
      panel.onStatus = onStatus;
      model.select(null);
      model.updateSurface(surface.id, { });
      surface.dst = rectQuad(0, 0, 0.2, 0.2);
      clickAt(0.9, 0.9);
      expect(onStatus).toHaveBeenCalledWith('Select a surface to mask', 'error');
    });

    it('reaches another surface\'s mask instead of mangling the selected one', () => {
      // The bug: with a second surface selected, clicking a point of the first
      // added a point to the SECOND, so a mask became uneditable as soon as
      // there was more than one surface.
      clickAt(0.1, 0.1);
      clickAt(0.4, 0.1);
      clickAt(0.4, 0.4);
      expect(surface.mask).toHaveLength(3);

      const other = model.addSurface({ dst: rectQuad(0.6, 0.6, 0.3, 0.3) });
      model.select(other.id);

      const first = panel._fromSurfaceUnit(surface, surface.mask[0].x, surface.mask[0].y);
      const at = panel._toScreen(first.x, first.y);
      panel._onPointerDown(pointer(at.x, at.y));

      expect(model.selectedId).toBe(surface.id);
      expect(panel._drag).toMatchObject({ kind: 'mask', surfaceId: surface.id, point: 0 });
      expect(other.mask).toEqual([]);
    });

    it('selects another surface when clicked inside it, without editing it blind', () => {
      surface.dst = rectQuad(0, 0, 0.4, 0.4); // so the click is genuinely elsewhere
      const other = model.addSurface({ dst: rectQuad(0.6, 0.6, 0.3, 0.3) });
      model.select(surface.id);
      clickAt(0.75, 0.75);
      expect(model.selectedId).toBe(other.id);
      expect(other.mask).toEqual([]);
    });

    it('keeps editing the selected surface where two overlap', () => {
      // Otherwise a point can never be added inside an overlap.
      clickAt(0.1, 0.1);
      clickAt(0.4, 0.1);
      clickAt(0.4, 0.4);
      model.addSurface({ dst: rectQuad(0, 0, 1, 1) });
      model.select(surface.id);
      clickAt(0.25, 0.25);
      expect(surface.mask).toHaveLength(4);
    });

    it('moves a point of a surface reached by clicking it', () => {
      clickAt(0.1, 0.1);
      clickAt(0.4, 0.1);
      clickAt(0.4, 0.4);
      const other = model.addSurface({ dst: rectQuad(0.6, 0.6, 0.3, 0.3) });
      model.select(other.id);

      const first = panel._fromSurfaceUnit(surface, surface.mask[0].x, surface.mask[0].y);
      const at = panel._toScreen(first.x, first.y);
      panel._onPointerDown(pointer(at.x, at.y));
      const to = panel._toScreen(first.x + 0.05, first.y + 0.05);
      panel._onPointerMove(pointer(to.x, to.y));

      expect(surface.mask[0].x).not.toBeCloseTo(0, 3);
    });
  });

  // --- per-surface sources ----------------------------------------------------
  //
  // Dropping a node on a surface wires it to that surface's pin on the
  // ProjectionMap node — the mapping in the shader, and so the thing that
  // carries a surface's own source all the way to the projector.

  describe('surface sources', () => {
    let graph;

    beforeEach(() => {
      graph = {
        nodes: [
          { id: '5', kind: 'Circle', params: {}, inputs: [] },
          { id: '6', kind: 'ComputeNoise', params: {}, inputs: [] },
          { id: '99', kind: 'OutputFinal', params: {}, inputs: [] },
        ],
        connections: [],
      };
      window.graph = graph;
      window.rebuild = vi.fn();
    });

    afterEach(() => {
      delete window.graph;
      delete window.rebuild;
    });

    const projectionNode = () => graph.nodes.find((n) => n.kind === 'ProjectionMap');

    it('creates the mapping node on the first drop rather than failing silently', () => {
      const surface = model.addSurface({ dst: rectQuad(0.2, 0.2, 0.4, 0.4) });
      expect(projectionNode()).toBeUndefined();

      expect(panel._setSource(0, '5')).toBe(true);

      const node = projectionNode();
      expect(node).toBeDefined();
      expect(node.inputs[0]).toBe('5');
      expect(surface).toBeDefined();
      expect(window.rebuild).toHaveBeenCalled(); // a changed pin changes the shader
    });

    it('gives each surface its own source', () => {
      model.addSurface();
      model.addSurface();
      panel._setSource(0, '5');
      panel._setSource(1, '6');
      expect(projectionNode().inputs).toEqual(['5', '6']);
      // The node must actually SHOW two pins, or the second wire lands past the
      // pin count and is pruned as out of range.
      expect(getInputCount(projectionNode())).toBe(2);
      // The label is what the node is CALLED in the graph, not its kind — a
      // user who dropped "Compute Noise" should not be told "ComputeNoise".
      expect(panel._sourceFor(0).label).toBe('Circle');
      expect(panel._sourceFor(1).label).toBe('Compute Noise');
    });

    it('reports no source for a surface that falls back to the composition', () => {
      model.addSurface();
      expect(panel._sourceFor(0)).toBeNull();
    });

    it('clears a source back to the composition', () => {
      model.addSurface();
      panel._setSource(0, '5');
      expect(panel._setSource(0, null)).toBe(true);
      expect(panel._sourceFor(0)).toBeNull();
    });

    it('shows the source in the surface list and the inspector', () => {
      model.addSurface();
      panel._setSource(0, '5');
      expect(panel.listEl.querySelector('.rz-map-source').textContent).toBe('Circle');
      expect(panel.inspectorEl.querySelector('.rz-map-source-name').textContent).toBe('Circle');
    });

    it('offers a Clear button only once a surface has a source', () => {
      model.addSurface();
      expect(panel.inspectorEl.querySelector('[data-act="clear-source"]')).toBeNull();
      panel._setSource(0, '5');
      expect(panel.inspectorEl.querySelector('[data-act="clear-source"]')).not.toBeNull();
    });



    it('hands the node the current geometry the moment it is created', () => {
      // The surfaces already exist when the node appears, so the model does not
      // CHANGE and the listener that normally syncs it never fires. Without this
      // every surface sits at the identity matrix — each covering the whole
      // frame, so the last drawn wins and the mapping only appears once a corner
      // is dragged.
      model.addSurface({ dst: rectQuad(0.1, 0.1, 0.4, 0.4) });
      model.addSurface({ dst: rectQuad(0.5, 0.5, 0.4, 0.4) });
      panel._setSource(0, '5');

      const node = projectionNode();
      // A quarter-size surface inverts to a scale of 2.5, not the identity's 1.
      expect(node.params.s0m0).toBeCloseTo(2.5, 6);
      expect(node.params.s1m0).toBeCloseTo(2.5, 6);
      // and the two surfaces are not sitting on top of each other
      expect(node.params.s0m2).not.toBeCloseTo(node.params.s1m2, 3);
    });

    it('records the wiring for undo and refreshes what the canvas shows', () => {
      // Writing the connection is only half of what a dragged wire does. Without
      // the rest the drop is not undoable, the wire is not drawn, and the node
      // keeps a thumbnail from before it was fed.
      const created = vi.fn();
      const deleted = vi.fn();
      const generateNodePreview = vi.fn();
      const markDirty = vi.fn();
      const draw = vi.fn();
      window.onConnectionCreated = created;
      window.onConnectionDeleted = deleted;
      window.editor = { graph, previewIntegration: { generateNodePreview }, markDirty, draw };

      try {
        model.addSurface();
        panel._setSource(0, '5');

        const node = projectionNode();
        expect(created).toHaveBeenCalledWith('5', node.id, 0, 0);
        expect(generateNodePreview).toHaveBeenCalledWith(node);
        expect(markDirty).toHaveBeenCalled();
        expect(draw).toHaveBeenCalled();

        // Re-feeding the surface retires the wire it replaces.
        panel._setSource(0, '6');
        expect(deleted).toHaveBeenCalledWith(expect.objectContaining({
          targetNode: node,
          targetInput: 0,
          sourceOutput: 0,
        }));
      } finally {
        delete window.onConnectionCreated;
        delete window.onConnectionDeleted;
        delete window.editor;
      }
    });

    it('completes the drop even when the editor callbacks throw', () => {
      window.onConnectionCreated = () => { throw new Error('undo broke'); };
      window.editor = {
        graph,
        previewIntegration: { generateNodePreview: () => { throw new Error('preview broke'); } },
        markDirty: () => { throw new Error('draw broke'); },
      };
      try {
        model.addSurface();
        expect(panel._setSource(0, '5')).toBe(true);
        expect(projectionNode().inputs[0]).toBe('5');
      } finally {
        delete window.onConnectionCreated;
        delete window.editor;
      }
    });


    it('stops warping locally as soon as the mapping has a node', () => {
      // The node IS the mapping. Warping here too would either map a mapping or
      // paint the composition onto a surface whose source is something else.
      model.addSurface();
      expect(panel._node()).toBeNull();
      panel._setSource(0, '5');
      expect(panel._node()).not.toBeNull();
    });


    it('carries each surface\'s source with it when the order changes', () => {
      // A source sits on the pin for the surface's POSITION, so reordering used to
      // leave the sources behind and hand every surface its neighbour's texture.
      const a = model.addSurface();
      const b = model.addSurface();
      panel._setSource(0, '5');
      panel._setSource(1, '6');
      expect(panel._sourceFor(0).id).toBe('5');

      panel.panel.querySelector('[data-act="forward"]').dataset.id = a.id;
      panel.panel.querySelector('[data-act="forward"]').click();

      // `a` is now second and must still be showing its own source.
      expect(model.surfaces.map((s) => s.id)).toEqual([b.id, a.id]);
      expect(panel._sourceFor(0).id).toBe('6');
      expect(panel._sourceFor(1).id).toBe('5');
    });

    it('carries sources across a deletion', () => {
      const a = model.addSurface();
      const b = model.addSurface();
      panel._setSource(0, '5');
      panel._setSource(1, '6');

      const remove = document.createElement('button');
      remove.dataset.act = 'remove';
      remove.dataset.id = a.id;
      panel.panel.appendChild(remove);
      remove.click();
      remove.remove();

      expect(model.surfaces.map((s) => s.id)).toEqual([b.id]);
      // The surviving surface keeps ITS source, not the deleted one's.
      expect(panel._sourceFor(0).id).toBe('6');
    });

    it('drops the pin a deleted surface was using', () => {
      model.addSurface();
      model.addSurface();
      panel._setSource(0, '5');
      panel._setSource(1, '6');
      expect(getInputCount(projectionNode())).toBe(2);

      const remove = document.createElement('button');
      remove.dataset.act = 'remove';
      remove.dataset.id = model.surfaces[1].id;
      panel.panel.appendChild(remove);
      remove.click();
      remove.remove();

      expect(getInputCount(projectionNode())).toBe(1);
      expect(graph.connections.filter((c) => c.to.pin === 1)).toHaveLength(0);
    });

    it('gives a duplicate the source it was copied from', () => {
      const a = model.addSurface();
      panel._setSource(0, '5');

      const dup = document.createElement('button');
      dup.dataset.act = 'duplicate';
      dup.dataset.id = a.id;
      panel.panel.appendChild(dup);
      dup.click();
      dup.remove();

      expect(model.surfaces).toHaveLength(2);
      expect(panel._sourceFor(0).id).toBe('5');
      expect(panel._sourceFor(1).id).toBe('5');
    });

    it('knows when the node is already putting the mapping on screen', () => {
      model.addSurface();
      panel._setSource(0, '5');
      const node = projectionNode();
      // Not wired to the output yet.
      expect(panel._nodeDrivesOutput()).toBe(false);
      graph.nodes.find((n) => n.kind === 'OutputFinal').inputs = [node.id];
      expect(panel._nodeDrivesOutput()).toBe(true);
    });

    it('follows the graph back through intermediate nodes to the output', () => {
      model.addSurface();
      panel._setSource(0, '5');
      const node = projectionNode();
      graph.nodes.push({ id: '50', kind: 'ColorInvert', params: {}, inputs: [node.id] });
      graph.nodes.find((n) => n.kind === 'OutputFinal').inputs = ['50'];
      expect(panel._nodeDrivesOutput()).toBe(true);
    });

    it('survives a cycle in the graph while walking back from the output', () => {
      graph.nodes.find((n) => n.kind === 'OutputFinal').inputs = ['5'];
      graph.nodes.find((n) => n.id === '5').inputs = ['99'];
      expect(() => panel._nodeDrivesOutput()).not.toThrow();
    });
  });

  describe('drop zone', () => {
    let graph;

    beforeEach(() => {
      graph = { nodes: [{ id: '5', kind: 'Circle', params: {}, inputs: [] }], connections: [] };
      window.graph = graph;
      window.rebuild = vi.fn();
    });

    afterEach(() => {
      delete window.graph;
      delete window.rebuild;
    });

    /** The zone the panel registers, reached the way the drag controller does. */
    function zoneOf(p) {
      let captured = null;
      const original = p._unregisterDropZone;
      // The panel registers on show(); capture what it handed over.
      p._unregisterDrop();
      p._unregisterDropZone = original;
      const spy = vi.spyOn(dropModule, 'registerNodeDropZone').mockImplementation((z) => {
        captured = z;
        return () => {};
      });
      p._registerDropZone();
      spy.mockRestore();
      return captured;
    }

    it('registers only while the panel is open', () => {
      expect(panel._unregisterDropZone).toBeNull();
      panel.show();
      expect(panel._unregisterDropZone).not.toBeNull();
      panel.hide();
      expect(panel._unregisterDropZone).toBeNull();
    });

    it('accepts a drag only with somewhere to put it', () => {
      const zone = zoneOf(panel);
      panel.visible = true;
      expect(zone.accepts('5')).toBe(false); // no surfaces yet
      model.addSurface();
      expect(zone.accepts('5')).toBe(true);
      // Cropping edits what a surface shows, not which source feeds it.
      panel.editMode = 'src';
      expect(zone.accepts('5')).toBe(false);
    });

    it('hit-tests the pointer onto the surface under it', () => {
      panel.visible = true;
      const back = model.addSurface({ dst: rectQuad(0, 0, 1, 1) });
      const front = model.addSurface({ dst: rectQuad(0.4, 0.4, 0.2, 0.2) });
      const zone = zoneOf(panel);

      const over = panel._toScreen(0.5, 0.5);
      expect(zone.hitTest(over.x, over.y).surface.id).toBe(front.id);

      const behind = panel._toScreen(0.05, 0.05);
      expect(zone.hitTest(behind.x, behind.y).surface.id).toBe(back.id);
    });

    it('ignores a pointer outside the stage', () => {
      panel.visible = true;
      model.addSurface({ dst: rectQuad(0, 0, 1, 1) });
      const zone = zoneOf(panel);
      expect(zone.hitTest(-500, -500)).toBeNull();
      expect(zone.hitTest(STAGE_W + 500, STAGE_H + 500)).toBeNull();
    });

    it('wires the dropped node to the surface it was released on', () => {
      panel.visible = true;
      model.addSurface({ dst: rectQuad(0, 0, 0.4, 0.4) });
      model.addSurface({ dst: rectQuad(0.5, 0.5, 0.4, 0.4) });
      const zone = zoneOf(panel);

      const onSecond = panel._toScreen(0.7, 0.7);
      const hit = zone.hitTest(onSecond.x, onSecond.y);
      zone.drop(hit, '5');

      const node = graph.nodes.find((n) => n.kind === 'ProjectionMap');
      expect(node.inputs[1]).toBe('5');
      expect(node.inputs[0]).toBeNull();
      // and the canvas has a wire to show for it
      expect(graph.connections).toContainEqual({
        from: { nodeId: '5', pin: 0 },
        to: { nodeId: node.id, pin: 1 },
      });
    });

    it('names the surface a release would hit', () => {
      panel.visible = true;
      const surface = model.addSurface({ dst: rectQuad(0, 0, 1, 1) });
      model.updateSurface(surface.id, { name: 'Left wall' });
      const zone = zoneOf(panel);
      const over = panel._toScreen(0.5, 0.5);
      expect(zone.label(zone.hitTest(over.x, over.y))).toBe('→ Left wall');
    });

    it('marks the surface under the pointer so the stage can show it', () => {
      panel.visible = true;
      model.addSurface({ dst: rectQuad(0, 0, 1, 1) });
      const zone = zoneOf(panel);
      zone.highlight({ index: 0 });
      expect(panel._dropTarget).toBe(0);
      zone.highlight(null);
      expect(panel._dropTarget).toBeNull();
    });
  });
});
