// Pins live in the content area below the thumbnail band and are centered between the title row
// (PIN_TOP) and the bottom id strip (PIN_ID_RESERVE), so a single pin sits at the content's middle.

import { describe, it, expect } from 'vitest';
import { pinGroupStartY, PIN_TOP, PIN_SPACING, PIN_ID_RESERVE } from '../src/core/pinLayout.js';

describe('pinGroupStartY centers a pin group within the content area', () => {
  it('centers a single pin on a default-height node with no thumbnail', () => {
    // region [y+32, y+58] on an 80px node -> center y+45.
    expect(pinGroupStartY({ y: 0, h: 80 }, 1)).toBe(45);
  });

  it('centers a single pin lower on a taller node', () => {
    // region [y+32, y+98] on a 120px node -> center y+65.
    expect(pinGroupStartY({ y: 0, h: 120 }, 1)).toBe(65);
  });

  it('offsets the pin region below the thumbnail band', () => {
    // band 140, h = 140 + content(54) = 194 -> region [y+172, y+172] -> y+172 (just below the band).
    expect(pinGroupStartY({ y: 0, h: 194, __thumbBand: 140 }, 1)).toBe(172);
  });

  it('keeps the first pin below the title row when the node only just fits its pins', () => {
    // 4 pins need content 32 + 3*18 + 22 = 108; centering collapses to the top anchor (y+32),
    // and the last pin sits PIN_SPACING*3 below that, inside the box.
    const start = pinGroupStartY({ y: 0, h: 108 }, 4);
    expect(start).toBe(PIN_TOP);
    expect(start + 3 * PIN_SPACING).toBe(86);
  });

  it('respects the node origin offset', () => {
    expect(pinGroupStartY({ y: 200, h: 80 }, 1)).toBe(245);
  });

  it('exposes the expected layout constants', () => {
    expect([PIN_TOP, PIN_SPACING, PIN_ID_RESERVE]).toEqual([32, 18, 22]);
  });
});
