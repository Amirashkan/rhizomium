// Pins are centered vertically on the node so a single output lands at the node's middle instead
// of near the top (which looked "a little upper" on the now-taller nodes). On a node sized to
// exactly fit many pins this collapses back to the old top-anchored layout.

import { describe, it, expect } from 'vitest';
import { pinGroupStartY, PIN_TOP, PIN_SPACING } from '../src/core/pinLayout.js';

describe('pinGroupStartY centers a pin group on the node', () => {
  it('places a single pin at the node center on a default-height node', () => {
    // h=80 -> center y+40; clamped within [y+32, y+64] -> y+40.
    expect(pinGroupStartY({ y: 0, h: 80 }, 1)).toBe(40);
  });

  it('centers a single pin on a tall (big-thumbnail) node', () => {
    // h=160 -> center y+80; well within the clamp range.
    expect(pinGroupStartY({ y: 0, h: 160 }, 1)).toBe(80);
  });

  it('keeps the first pin below the title bar when the node only just fits its pins', () => {
    // 4 pins need height 32 + 3*18 + 16 = 102; centering collapses to the top anchor (y+32).
    expect(pinGroupStartY({ y: 0, h: 102 }, 4)).toBe(PIN_TOP);
    // And the pins step down by PIN_SPACING from there.
    const start = pinGroupStartY({ y: 0, h: 102 }, 4);
    expect(start + 3 * PIN_SPACING).toBe(86); // last pin inside the 102px box
  });

  it('respects the node origin offset', () => {
    expect(pinGroupStartY({ y: 200, h: 80 }, 1)).toBe(240);
  });
});
