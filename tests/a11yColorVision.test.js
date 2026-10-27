// Colour-vision profiles for the preview: the maths, the SVG filter, and that only the artist's
// view is touched.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CVD_SIMULATION_MATRICES,
  CVD_FILTER_ID,
  colorVisionMatrix,
  applyColorMatrix,
  feColorMatrixValues,
  ensureColorVisionFilter,
  installColorVision,
  colorVisionCanvasFilter,
  COLOR_VISION_LABELS,
} from '../src/accessibility/colorVision.js';
import { A11ySettings, COLOR_VISION_PROFILES } from '../src/accessibility/a11ySettings.js';

const close = (a, b, eps = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) < eps);

function storeWith(values = {}) {
  const store = new A11ySettings({ storage: null, matchMedia: () => null });
  store.setMany(values);
  return store;
}

describe('colour-vision matrices', () => {
  it('has a simulation and a label for every profile the settings offer', () => {
    for (const profile of COLOR_VISION_PROFILES) {
      expect(COLOR_VISION_LABELS[profile]).toBeTruthy();
      if (profile === 'none') continue;
      expect(CVD_SIMULATION_MATRICES[profile]).toBeTruthy();
    }
  });

  it('leaves black, white and greys alone in every simulation', () => {
    for (const profile of Object.keys(CVD_SIMULATION_MATRICES)) {
      const m = colorVisionMatrix(profile, 'simulate');
      for (const grey of [0, 0.25, 0.5, 1]) {
        expect(close(applyColorMatrix(m, [grey, grey, grey]), [grey, grey, grey], 1e-3)).toBe(true);
      }
    }
  });

  it('collapses red and green for a deuteranope', () => {
    const m = colorVisionMatrix('deuteranopia');
    const red = applyColorMatrix(m, [1, 0, 0]);
    const green = applyColorMatrix(m, [0, 1, 0]);
    // Pure red and pure green land on the same yellow-brown hue: red and green channels move
    // together, blue stays near zero.
    expect(Math.abs(red[0] / red[1] - green[0] / green[1])).toBeLessThan(0.1);
    expect(Math.abs(red[2])).toBeLessThan(0.02);
  });

  it('reduces achromatopsia to luminance', () => {
    const m = colorVisionMatrix('achromatopsia');
    const out = applyColorMatrix(m, [1, 0, 0]);
    expect(close(out, [0.2126, 0.2126, 0.2126])).toBe(true);
  });

  it('correction keeps greys and pulls confusable colours apart', () => {
    for (const profile of ['protanopia', 'deuteranopia', 'tritanopia', 'deuteranomaly']) {
      const correct = colorVisionMatrix(profile, 'correct');
      expect(close(applyColorMatrix(correct, [0.5, 0.5, 0.5]), [0.5, 0.5, 0.5], 1e-3)).toBe(true);
    }

    // Seen through deuteranopia, red and green are hard to tell apart; corrected first, they are
    // further apart than before.
    const sim = colorVisionMatrix('deuteranopia', 'simulate');
    const cor = colorVisionMatrix('deuteranopia', 'correct');
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const red = [0.8, 0.2, 0.1];
    const green = [0.3, 0.6, 0.1];
    const before = distance(applyColorMatrix(sim, red), applyColorMatrix(sim, green));
    const after = distance(
      applyColorMatrix(sim, applyColorMatrix(cor, red)),
      applyColorMatrix(sim, applyColorMatrix(cor, green)),
    );
    expect(after).toBeGreaterThan(before);
  });

  it('has nothing to correct for achromatopsia, and nothing at all for "none"', () => {
    expect(colorVisionMatrix('achromatopsia', 'correct')).toBeNull();
    expect(colorVisionMatrix('none')).toBeNull();
    expect(colorVisionMatrix('bogus')).toBeNull();
  });

  it('writes a 4×5 feColorMatrix row list', () => {
    const values = feColorMatrixValues(colorVisionMatrix('protanopia')).split(' ');
    expect(values).toHaveLength(20);
    expect(values.slice(15)).toEqual(['0', '0', '0', '1', '0']);
  });
});

describe('colour-vision filter in the page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete document.documentElement.dataset.rzCvd;
  });

  it('keeps one shared filter element and updates it in place', () => {
    const first = ensureColorVisionFilter(document, colorVisionMatrix('protanopia'));
    const second = ensureColorVisionFilter(document, colorVisionMatrix('tritanopia'));
    expect(first).toBe(second);
    expect(document.querySelectorAll(`#${CVD_FILTER_ID}`)).toHaveLength(1);
    expect(first.getAttribute('color-interpolation-filters')).toBe('linearRGB');
    expect(first.querySelector('feColorMatrix').getAttribute('values')).toBe(
      feColorMatrixValues(colorVisionMatrix('tritanopia')),
    );
  });

  it('follows the setting: attribute for the stylesheet, filter string for thumbnails', () => {
    const settings = storeWith();
    const changes = [];
    const stop = installColorVision({ settings, doc: document, onChange: (c) => changes.push(c) });

    expect(document.documentElement.dataset.rzCvd).toBeUndefined();
    expect(colorVisionCanvasFilter()).toBe('none');

    settings.set('colorVision', 'deuteranopia');
    expect(document.documentElement.dataset.rzCvd).toBe('deuteranopia-simulate');
    expect(colorVisionCanvasFilter()).toBe(`url(#${CVD_FILTER_ID})`);

    settings.set('colorVisionMode', 'correct');
    expect(document.documentElement.dataset.rzCvd).toBe('deuteranopia-correct');

    settings.set('colorVision', 'none');
    expect(document.documentElement.dataset.rzCvd).toBeUndefined();
    expect(colorVisionCanvasFilter()).toBe('none');
    expect(changes.at(-1)).toEqual({ profile: 'none', mode: 'correct' });

    stop();
  });
});
