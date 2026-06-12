/**
 * Phase 1 regression tests: the "warmup" system must never run synchronous
 * renders from input handlers or background timers.
 *
 * Background: _checkAndWarmupAfterInactivity used to fire up to 15
 * synchronous renderNow() calls plus up to 10 onDraw() calls after any
 * >100ms pause, and _startContinuousWarmup ran 6 full renders every 300ms
 * while idle. Render cost scales with patch size, so heavy patches froze
 * at the start of every pan/zoom gesture. These tests pin the fix.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventHandler } from '../src/core/EventHandler.js';

function createEventHandler() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const renderNow = vi.fn();
  const onDraw = vi.fn();
  const markDirty = vi.fn();

  const editor = {
    renderLoopController: { renderNow },
    markDirty,
    ctx: canvas.getContext?.('2d') || null,
    graph: { nodes: [] },
  };

  const viewport = {
    isPanning: () => false,
    stopPan: vi.fn(),
    updatePan: vi.fn(() => false),
    zoom: vi.fn(() => false),
    screenToCanvas: (x, y) => ({ x, y }),
    canvasToScreen: (x, y) => ({ x, y }),
  };

  const handler = new EventHandler({
    canvas,
    viewport,
    selection: {
      getDragging: () => false,
      getBoxSelect: () => null,
      deleteSelected: vi.fn(),
      graph: { selection: new Set() },
    },
    connections: { getDragWire: () => null },
    menu: { hide: vi.fn(), contains: () => false },
    paramPanel: { hide: vi.fn(), panel: null },
    onChange: vi.fn(),
    onDraw,
    editor,
  });

  return { handler, canvas, renderNow, onDraw, markDirty, viewport };
}

describe('EventHandler warmup removal', () => {
  let ctx;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = createEventHandler();
  });

  afterEach(() => {
    ctx.handler._stopContinuousWarmup?.();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('does not run synchronous renders after inactivity', () => {
    const { handler, renderNow, onDraw, markDirty } = ctx;

    // Simulate long inactivity, then the check that input handlers call
    handler._lastInteractionTime = Date.now() - 30000;
    handler._checkAndWarmupAfterInactivity();

    expect(renderNow).not.toHaveBeenCalled();
    expect(onDraw).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('still tracks interaction timing after a pause', () => {
    const { handler } = ctx;

    handler._lastInteractionTime = Date.now() - 30000;
    handler._checkAndWarmupAfterInactivity();

    expect(handler._justWarmedUp).toBe(true);
    expect(Date.now() - handler._lastInteractionTime).toBeLessThan(100);
    expect(handler._interactionStartTime).toBeGreaterThan(0);

    // Flag clears after the immediate-update window
    vi.advanceTimersByTime(5000);
    expect(handler._justWarmedUp).toBe(false);
  });

  it('does not run background renders while idle (continuous warmup removed)', () => {
    const { handler, renderNow, onDraw } = ctx;

    // Simulate being idle for a long time with the handler constructed
    handler._lastInteractionTime = Date.now() - 30000;
    vi.advanceTimersByTime(10000);

    expect(renderNow).not.toHaveBeenCalled();
    expect(onDraw).not.toHaveBeenCalled();
    expect(handler._warmupTimer).toBeNull();
  });

  it('does not run synchronous renders from the wheel handler', () => {
    const { canvas, renderNow, onDraw, handler } = ctx;

    handler._lastInteractionTime = Date.now() - 30000;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 10, clientY: 10 }));

    expect(renderNow).not.toHaveBeenCalled();
    expect(onDraw).not.toHaveBeenCalled();
  });

  it('does not run synchronous renders from mousemove after a pause', () => {
    const { renderNow, onDraw, handler } = ctx;

    handler._lastInteractionTime = Date.now() - 30000;
    handler._lastMouseMoveTime = Date.now() - 30000;
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));

    expect(renderNow).not.toHaveBeenCalled();
    expect(onDraw).not.toHaveBeenCalled();
  });
});
