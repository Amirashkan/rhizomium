// Preferences → Accessibility: the settings store every accessibility feature reads.
//
// What matters here is that a bad value can never get in (storage is editable and outlives
// renamed options), that "follow the system" really follows it, and that the document root
// carries exactly the attributes src/styles/accessibility.css keys off.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  A11ySettings,
  A11Y_SCHEMA,
  normalizeA11yValue,
  applyA11yToDocument,
  installA11yDocumentSync,
} from '../src/accessibility/a11ySettings.js';

/** A Storage stand-in. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    dump: () => Object.fromEntries(data),
  };
}

/** matchMedia with switchable answers and change events. */
function fakeMedia(answers = {}) {
  const lists = new Map();
  const matchMedia = (query) => {
    if (!lists.has(query)) {
      const listeners = new Set();
      lists.set(query, {
        get matches() {
          return !!answers[query];
        },
        addEventListener: (_type, fn) => listeners.add(fn),
        removeEventListener: (_type, fn) => listeners.delete(fn),
        _fire: () => listeners.forEach((fn) => fn()),
      });
    }
    return lists.get(query);
  };
  matchMedia.set = (query, value) => {
    answers[query] = value;
    lists.get(query)?._fire();
  };
  return matchMedia;
}

describe('normalizeA11yValue', () => {
  it('accepts only the listed options for enum settings', () => {
    expect(normalizeA11yValue('contrast', 'high')).toBe('high');
    expect(normalizeA11yValue('contrast', 'neon')).toBeUndefined();
    expect(normalizeA11yValue('colorVision', 'deuteranopia')).toBe('deuteranopia');
    expect(normalizeA11yValue('nope', 'x')).toBeUndefined();
  });

  it('clamps and snaps the interface size', () => {
    expect(normalizeA11yValue('uiScale', 1.2499999)).toBe(1.25);
    expect(normalizeA11yValue('uiScale', 9)).toBe(2);
    expect(normalizeA11yValue('uiScale', 0.2)).toBe(1);
    expect(normalizeA11yValue('uiScale', '1.5')).toBe(1.5);
    expect(normalizeA11yValue('uiScale', 'big')).toBeUndefined();
  });

  it('lets motionWarnings go back to "not chosen"', () => {
    expect(normalizeA11yValue('motionWarnings', true)).toBe(true);
    expect(normalizeA11yValue('motionWarnings', null)).toBe(null);
    expect(normalizeA11yValue('motionWarnings', 'yes')).toBeUndefined();
  });
});

describe('A11ySettings', () => {
  let storage;
  let media;

  beforeEach(() => {
    storage = memoryStorage();
    media = fakeMedia();
  });

  it('starts from the schema defaults', () => {
    const store = new A11ySettings({ storage, matchMedia: media });
    for (const [key, spec] of Object.entries(A11Y_SCHEMA)) {
      if (key === 'motionWarnings') continue; // resolved, see below
      expect(store.get(key)).toEqual(spec.default);
    }
    expect(store.effectiveContrast()).toBe('standard');
    expect(store.prefersReducedMotion()).toBe(false);
    expect(store.motionWarningsEnabled()).toBe(false);
  });

  it('persists what is set and reads it back on the next start', () => {
    const store = new A11ySettings({ storage, matchMedia: media });
    expect(store.set('contrast', 'maximum')).toBe(true);
    expect(store.set('uiScale', 1.5)).toBe(true);

    const reopened = new A11ySettings({ storage, matchMedia: media });
    expect(reopened.get('contrast')).toBe('maximum');
    expect(reopened.get('uiScale')).toBe(1.5);
  });

  it('refuses values the setting does not accept, and keeps the old one', () => {
    const store = new A11ySettings({ storage, matchMedia: media });
    store.set('contrast', 'high');
    expect(store.set('contrast', 'blinding')).toBe(false);
    expect(store.get('contrast')).toBe('high');
  });

  it('drops stored values that no longer fit instead of trusting them', () => {
    storage.setItem(
      'rhizo.accessibility',
      JSON.stringify({ contrast: 'retro', uiScale: 1.75, colorVision: 'nope', mystery: 1 }),
    );
    const store = new A11ySettings({ storage, matchMedia: media });
    expect(store.get('contrast')).toBe('system');
    expect(store.get('uiScale')).toBe(1.75);
    expect(store.get('colorVision')).toBe('none');
  });

  it('survives an unreadable record', () => {
    storage.setItem('rhizo.accessibility', '{not json');
    expect(() => new A11ySettings({ storage, matchMedia: media })).not.toThrow();
  });

  it('follows the system contrast and forced-colours preferences until one is chosen', () => {
    const store = new A11ySettings({ storage, matchMedia: media });
    media.set('(prefers-contrast: more)', true);
    expect(store.effectiveContrast()).toBe('high');
    media.set('(forced-colors: active)', true);
    expect(store.effectiveContrast()).toBe('maximum');

    store.set('contrast', 'standard');
    expect(store.effectiveContrast()).toBe('standard');
  });

  it('turns motion warnings on by default for people who asked their OS to reduce motion', () => {
    const store = new A11ySettings({ storage, matchMedia: media });
    expect(store.motionWarningsEnabled()).toBe(false);
    media.set('(prefers-reduced-motion: reduce)', true);
    expect(store.motionWarningsEnabled()).toBe(true);
    expect(store.prefersReducedMotion()).toBe(true);

    // An explicit choice wins over the system, either way.
    store.set('motionWarnings', false);
    expect(store.motionWarningsEnabled()).toBe(false);
    store.set('motionWarnings', null);
    expect(store.motionWarningsEnabled()).toBe(true);
    expect(store.isExplicit('motionWarnings')).toBe(false);
  });

  it('tells subscribers what changed, including system preference flips', () => {
    const store = new A11ySettings({ storage, matchMedia: media });
    const seen = [];
    const off = store.subscribe((change) => seen.push(change.key));
    store.watchSystemPreferences();

    store.set('focusRing', 'bold');
    store.set('focusRing', 'bold'); // no change, no event
    media.set('(prefers-reduced-motion: reduce)', true);
    store.reset();
    off();
    store.set('contrast', 'high');

    expect(seen).toEqual(['focusRing', 'system', '*']);
  });

  it('keeps notifying the rest when one listener throws', () => {
    const store = new A11ySettings({ storage, matchMedia: media });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = vi.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(good);
    store.set('announcements', 'verbose');
    expect(good).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('clears storage on reset', () => {
    const store = new A11ySettings({ storage, matchMedia: media });
    store.set('contrast', 'high');
    store.reset();
    expect(storage.dump()).toEqual({});
    expect(store.get('contrast')).toBe('system');
  });
});

describe('applyA11yToDocument', () => {
  it('writes the attributes the stylesheet keys off', () => {
    const store = new A11ySettings({ storage: memoryStorage(), matchMedia: fakeMedia() });
    const root = document.documentElement;

    applyA11yToDocument(store, document);
    expect(root.dataset.rzContrast).toBe('standard');
    expect(root.dataset.rzMotion).toBe('full');
    expect(root.dataset.rzFocus).toBe('standard');
    expect(root.dataset.rzScaled).toBeUndefined();
    expect(root.style.getPropertyValue('--rz-ui-scale')).toBe('1');

    store.setMany({ contrast: 'high', reduceMotion: 'reduce', focusRing: 'bold', uiScale: 1.5 });
    applyA11yToDocument(store, document);
    expect(root.dataset.rzContrast).toBe('high');
    expect(root.dataset.rzMotion).toBe('reduced');
    expect(root.dataset.rzFocus).toBe('bold');
    expect(root.dataset.rzScaled).toBe('true');
    expect(root.style.getPropertyValue('--rz-ui-scale')).toBe('1.5');
  });

  it('keeps the document in step once installed', () => {
    const media = fakeMedia();
    const store = new A11ySettings({ storage: memoryStorage(), matchMedia: media });
    const stop = installA11yDocumentSync(store, document);
    const root = document.documentElement;

    store.set('contrast', 'maximum');
    expect(root.dataset.rzContrast).toBe('maximum');

    store.set('contrast', 'system');
    media.set('(prefers-contrast: more)', true);
    expect(root.dataset.rzContrast).toBe('high');

    stop();
    store.set('contrast', 'standard');
    expect(root.dataset.rzContrast).toBe('high');
  });
});
