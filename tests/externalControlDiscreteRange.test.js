import { describe, it, expect } from 'vitest';
import { discreteControlRange, mapNormalizedValue } from '../src/parameters/ExternalParameterControl.js';

// A dropdown carries no min/max in its definition, so a new MIDI/OSC binding used to default to
// 0..1 — which maps a whole knob sweep onto the first two of a Mix node's nine blend modes. A
// discrete parameter is addressed by option index, so its range is 0..n-1.

describe('discreteControlRange', () => {
  it('spans the option indices of a dropdown', () => {
    const range = discreteControlRange({ kind: 'ComputeMix' }, 'mode');
    expect(range).toEqual({ min: 0, max: 8 }); // nine blend modes

    // A knob at the top of its travel reaches the last option rather than the second.
    expect(mapNormalizedValue(1, range)).toBe(8);
    expect(Math.round(mapNormalizedValue(0.5, range))).toBe(4);
  });

  it('spans off/on for a toggle', () => {
    expect(discreteControlRange({ kind: 'Flip2D' }, 'flipX')).toEqual({ min: 0, max: 1 });
  });

  it('declines to answer for a numeric parameter, which has its own min/max', () => {
    expect(discreteControlRange({ kind: 'ComputeMix' }, 'amount')).toBeNull();
    expect(discreteControlRange({ kind: 'NotARealNode' }, 'whatever')).toBeNull();
  });
});
