// Regression test: nodes with many pins (e.g. the 4-output Resolution node) must grow tall
// enough that no pin spills past the bottom edge. Pins are laid out from y+32 at 18px spacing,
// so a fixed 80px box couldn't contain 4 output pins (the 4th sits at y+86).

import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/core/Renderer.js';

describe('_minNodeHeight grows the node box to fit its pins', () => {
  const renderer = new Renderer(null, null, {});

  it('keeps the default height for nodes with few pins', () => {
    // 2 pins -> 32 + 18 + 16 = 66, below the 80px default, so the default still wins.
    expect(renderer._minNodeHeight({ kind: 'Add' })).toBeLessThanOrEqual(80);
  });

  it('is tall enough to contain all four Resolution output pins', () => {
    // 4 pins -> 32 + 3*18 + 16 = 102, and the lowest pin sits at 32 + 3*18 = 86.
    const h = renderer._minNodeHeight({ kind: 'Resolution' });
    expect(h).toBe(102);
    expect(h).toBeGreaterThan(86);
  });
});
