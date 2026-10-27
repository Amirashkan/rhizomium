// The drawn graph's side of Preferences → Accessibility → Contrast: the live palette in theme.js.

import { describe, it, expect, afterEach } from 'vitest';
import {
  SURFACE,
  TEXT,
  NODE_CHROME,
  NODE_STYLE,
  applyContrastPalette,
  activeContrastLevel,
  paletteVersion,
} from '../src/core/theme.js';

describe('applyContrastPalette', () => {
  afterEach(() => applyContrastPalette('standard'));

  it('rewrites the shared palette objects in place and restores them', () => {
    const standardText = TEXT.tertiary;
    const standardBorder = NODE_CHROME.border;
    const standardWire = NODE_CHROME.wireWidth;

    expect(applyContrastPalette('high')).toBe(true);
    expect(activeContrastLevel()).toBe('high');
    expect(TEXT.tertiary).not.toBe(standardText);
    expect(NODE_CHROME.border).not.toBe(standardBorder);
    expect(NODE_CHROME.wireWidth).toBeGreaterThan(standardWire);

    expect(applyContrastPalette('maximum')).toBe(true);
    expect(SURFACE.nodeTop).toBe('#000000');
    expect(NODE_STYLE.portRing).toBe('#000000');
    expect(TEXT.primary).toBe('#ffffff');

    expect(applyContrastPalette('standard')).toBe(true);
    expect(TEXT.tertiary).toBe(standardText);
    expect(NODE_CHROME.border).toBe(standardBorder);
    expect(NODE_CHROME.wireWidth).toBe(standardWire);
    expect(NODE_STYLE.portRing).toBe('#1a1611');
  });

  it('bumps the palette version so colour caches rebuild, and only on a real change', () => {
    const before = paletteVersion();
    expect(applyContrastPalette('standard')).toBe(false);
    expect(paletteVersion()).toBe(before);
    applyContrastPalette('high');
    expect(paletteVersion()).toBe(before + 1);
  });

  it('treats an unknown level as standard', () => {
    applyContrastPalette('high');
    applyContrastPalette('psychedelic');
    expect(activeContrastLevel()).toBe('standard');
  });
});
