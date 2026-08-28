import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ScreenModel,
  makeScreen,
  resetScreenIdCounter,
  MAIN_SCREEN_ID,
  MAX_SCREENS,
  DISPLAY_AUTO,
} from '../src/screens/ScreenModel.js';

describe('makeScreen', () => {
  beforeEach(() => resetScreenIdCounter(1));

  it('fills in every field from nothing', () => {
    const s = makeScreen();
    expect(s).toMatchObject({
      id: 'screen-1',
      enabled: true,
      displayIndex: DISPLAY_AUTO,
      displayMaxDim: 0,
      region: { x: 0, y: 0, w: 1, h: 1 },
    });
    expect(s.name).toBe('Screen 1');
  });

  it('names the single-output screen for what it is', () => {
    expect(makeScreen({ id: MAIN_SCREEN_ID }).name).toBe('Main output');
  });

  it('clamps a presentation resolution and rejects a nonsense display', () => {
    expect(makeScreen({ displayMaxDim: 99999 }).displayMaxDim).toBe(7680);
    expect(makeScreen({ displayMaxDim: 10 }).displayMaxDim).toBe(256);
    expect(makeScreen({ displayMaxDim: 0 }).displayMaxDim).toBe(0); // display's own
    expect(makeScreen({ displayIndex: -7 }).displayIndex).toBe(DISPLAY_AUTO);
  });
});

describe('ScreenModel', () => {
  let model;
  beforeEach(() => {
    resetScreenIdCounter(1);
    model = new ScreenModel();
  });

  it('starts empty and notifies on every change', () => {
    const seen = vi.fn();
    model.onChange(seen);
    expect(model.count).toBe(0);

    model.add({});
    expect(model.count).toBe(1);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes cleanly', () => {
    const seen = vi.fn();
    const off = model.onChange(seen);
    off();
    model.add({});
    expect(seen).not.toHaveBeenCalled();
  });

  it('survives a listener that throws', () => {
    model.onChange(() => { throw new Error('broken'); });
    const other = vi.fn();
    model.onChange(other);
    expect(() => model.add({})).not.toThrow();
    expect(other).toHaveBeenCalled();
  });

  it('ensureMain is idempotent and puts the main screen first', () => {
    model.add({});
    const main = model.ensureMain();
    expect(main.id).toBe(MAIN_SCREEN_ID);
    expect(model.list()[0].id).toBe(MAIN_SCREEN_ID);
    expect(model.ensureMain()).toBe(main);
    expect(model.count).toBe(2);
  });

  it('refuses to exceed the rig limit', () => {
    for (let i = 0; i < MAX_SCREENS; i++) expect(model.add({})).not.toBeNull();
    expect(model.add({})).toBeNull();
    expect(model.count).toBe(MAX_SCREENS);
  });

  it('never adds two screens under one id (ids are the window labels)', () => {
    expect(model.add({ id: 'dup' })).not.toBeNull();
    expect(model.add({ id: 'dup' })).toBeNull();
    expect(model.count).toBe(1);
  });

  it('reports only the screens that should hold a window', () => {
    model.add({ id: 'a' });
    model.add({ id: 'b', enabled: false });
    expect(model.enabledScreens().map((s) => s.id)).toEqual(['a']);
  });

  describe('update', () => {
    beforeEach(() => model.add({ id: 'a' }));

    it('patches only the fields given', () => {
      model.update('a', { name: 'Stage left' });
      expect(model.get('a')).toMatchObject({ name: 'Stage left', enabled: true });
    });

    it('does not notify when nothing actually changed', () => {
      const seen = vi.fn();
      model.onChange(seen);
      model.update('a', { name: model.get('a').name });
      // A slider dragged back to where it started must not restart a projector.
      expect(seen).not.toHaveBeenCalled();
    });

    it('sanitises a region on the way in', () => {
      model.update('a', { region: { x: 0.5, y: 0, w: 5, h: 1 } });
      expect(model.get('a').region.w).toBeCloseTo(0.5, 6);
    });

    it('ignores an unknown screen', () => {
      expect(model.update('nope', { name: 'x' })).toBeNull();
    });
  });

  it('removes and clears', () => {
    model.add({ id: 'a' });
    model.add({ id: 'b' });
    expect(model.remove('a')).toBe(true);
    expect(model.remove('a')).toBe(false);
    model.clear();
    expect(model.count).toBe(0);
  });

  describe('applyTiling', () => {
    it('lays a panorama out across three screens, named by place', () => {
      const screens = model.applyTiling({ cols: 3 });
      expect(screens.map((s) => s.name)).toEqual(['Left', 'Centre', 'Right']);
      expect(screens[0].id).toBe(MAIN_SCREEN_ID);
      expect(screens[1].region.x).toBeCloseTo(1 / 3, 6);
    });

    it('names a grid by row and column', () => {
      expect(model.applyTiling({ cols: 2, rows: 2 }).map((s) => s.name))
        .toEqual(['Top left', 'Top right', 'Bottom left', 'Bottom right']);
    });

    it('keeps display assignments when a rig is retiled', () => {
      model.applyTiling({ cols: 3 });
      model.update(model.list()[1].id, { displayIndex: 2, displayMaxDim: 1920 });
      const before = model.list()[1];

      model.applyTiling({ cols: 3, overlap: 0.1 });
      const after = model.list()[1];
      // Same window, new framing — the projector must not close and reopen.
      expect(after.id).toBe(before.id);
      expect(after.displayIndex).toBe(2);
      expect(after.displayMaxDim).toBe(1920);
      expect(after.region.w).toBeGreaterThan(1 / 3);
    });

    it('collapses back to a single mirrored screen', () => {
      model.applyTiling({ cols: 3 });
      const screens = model.applyTiling({ cols: 1, rows: 1 });
      expect(screens).toHaveLength(1);
      expect(screens[0].name).toBe('Main output');
      expect(screens[0].region).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips the rig', () => {
      model.applyTiling({ cols: 2 });
      model.update(model.list()[1].id, { displayIndex: 1, displayMaxDim: 2560 });
      const data = model.serialize();

      const loaded = new ScreenModel();
      loaded.deserialize(data);
      expect(loaded.list().map((s) => s.id)).toEqual(model.list().map((s) => s.id));
      expect(loaded.list()[1]).toMatchObject({ displayIndex: 1, displayMaxDim: 2560 });
      expect(loaded.list()[1].region.x).toBeCloseTo(0.5, 6);
    });

    it('loads every screen switched off', () => {
      // Opening a file must never throw windows onto attached displays.
      model.applyTiling({ cols: 2 });
      const loaded = new ScreenModel();
      loaded.deserialize(model.serialize());
      expect(loaded.enabledScreens()).toHaveLength(0);
    });

    it('does not write live on/off state into the project', () => {
      model.add({ id: 'a', enabled: true });
      expect(model.serialize().screens[0]).not.toHaveProperty('enabled');
    });

    it('drops unusable and duplicate entries rather than loading them broken', () => {
      model.deserialize({ screens: [null, { id: 'a' }, { id: 'a' }, 'junk'] });
      expect(model.list().map((s) => s.id)).toEqual(['a']);
    });

    it('accepts a bare array, and an empty load clears the rig', () => {
      model.deserialize([{ id: 'a' }]);
      expect(model.count).toBe(1);
      model.deserialize(null);
      expect(model.count).toBe(0);
    });

    it('keeps generated ids clear of the ones it just loaded', () => {
      model.deserialize({ screens: [{ id: 'screen-7' }] });
      expect(model.add({}).id).toBe('screen-8');
    });

    it('honours the rig limit when loading', () => {
      const screens = Array.from({ length: MAX_SCREENS + 4 }, (_, i) => ({ id: `screen-${i + 1}` }));
      model.deserialize({ screens });
      expect(model.count).toBe(MAX_SCREENS);
    });
  });
});
