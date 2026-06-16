import { describe, it, expect } from 'vitest';
import { letterboxRect } from '../src/ui/letterbox.js';

describe('letterboxRect', () => {
  it('fills the destination when aspect ratios match', () => {
    expect(letterboxRect(1920, 1080, 1920, 1080)).toEqual({ dx: 0, dy: 0, dw: 1920, dh: 1080 });
  });

  it('pillarboxes a square source in a wide destination', () => {
    const r = letterboxRect(100, 100, 200, 100);
    expect(r).toEqual({ dx: 50, dy: 0, dw: 100, dh: 100 });
  });

  it('letterboxes a wide source in a square destination', () => {
    const r = letterboxRect(200, 100, 100, 100);
    expect(r).toEqual({ dx: 0, dy: 25, dw: 100, dh: 50 });
  });

  it('returns zeros for non-positive sizes', () => {
    expect(letterboxRect(0, 100, 100, 100)).toEqual({ dx: 0, dy: 0, dw: 0, dh: 0 });
    expect(letterboxRect(100, 100, 100, 0)).toEqual({ dx: 0, dy: 0, dw: 0, dh: 0 });
  });
});
