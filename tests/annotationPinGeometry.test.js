import { describe, it, expect } from 'vitest';
import {
  annotationPinCenter,
  hitAnnotationPin,
  ANNOTATION_PIN_RADIUS,
} from '../src/core/pinLayout.js';
import { HEADER_H } from '../src/core/pinLayout.js';

/**
 * Where a review badge sits, and what counts as pressing it.
 *
 * This geometry lives in pinLayout.js precisely so the renderer that draws the
 * badge and the event handler that catches the click cannot disagree about it —
 * so the thing worth testing is the contract they both read.
 */

const node = { id: 'n1', x: 100, y: 200, w: 160, h: 90 };

describe('annotation pin geometry', () => {
  it('hangs on the node’s top-right corner', () => {
    const c = annotationPinCenter(node);
    expect(c.x).toBeCloseTo(node.x + node.w - 2);
    expect(c.y).toBeCloseTo(node.y + 2);
  });

  it('overhangs the card on both axes, so it sits on nothing else', () => {
    const c = annotationPinCenter(node);
    // Above the header band, and past the right edge — the corner is the only
    // part of the card carrying neither a control chip nor a port.
    expect(c.y - ANNOTATION_PIN_RADIUS).toBeLessThan(node.y);
    expect(c.y).toBeLessThan(node.y + HEADER_H);
    expect(c.x + ANNOTATION_PIN_RADIUS).toBeGreaterThan(node.x + node.w);
  });

  it('is pressed at its centre', () => {
    const c = annotationPinCenter(node);
    expect(hitAnnotationPin(node, c.x, c.y)).toBe(true);
  });

  it('is pressable a little wider than it is drawn', () => {
    const c = annotationPinCenter(node);
    // Just outside the drawn circle still counts: the badge is small in world
    // units and would be untouchable at a zoomed-out viewport otherwise.
    expect(hitAnnotationPin(node, c.x + ANNOTATION_PIN_RADIUS + 1, c.y)).toBe(true);
  });

  it('is not pressed from across the node', () => {
    expect(hitAnnotationPin(node, node.x + 10, node.y + node.h - 10)).toBe(false);
    expect(hitAnnotationPin(node, node.x + node.w / 2, node.y + 4)).toBe(false);
  });

  it('is not pressed from well outside the corner', () => {
    const c = annotationPinCenter(node);
    expect(hitAnnotationPin(node, c.x + 40, c.y - 40)).toBe(false);
  });

  it('survives a node with no geometry rather than throwing', () => {
    expect(() => annotationPinCenter(null)).not.toThrow();
    expect(hitAnnotationPin(null, 0, 0)).toBe(false);
    expect(annotationPinCenter({})).toEqual({ x: -2, y: 2 });
  });

  it('moves with its node', () => {
    const moved = { ...node, x: node.x + 300, y: node.y - 120 };
    const before = annotationPinCenter(node);
    const after = annotationPinCenter(moved);
    expect(after.x - before.x).toBe(300);
    expect(after.y - before.y).toBe(-120);
  });
});
