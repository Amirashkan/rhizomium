import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RenderLoop } from '../src/core/RenderLoop.js';

describe('RenderLoop', () => {
  let queue;

  beforeEach(() => {
    queue = [];
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      queue.push(cb);
      return nextId++;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function tick(ts) {
    const callbacks = queue;
    queue = [];
    callbacks.forEach((cb) => cb(ts));
  }

  it('keeps scheduling frames after the frame callback throws', () => {
    let calls = 0;
    const loop = new RenderLoop({
      onFrame: () => {
        calls++;
        if (calls === 1) throw new Error('boom');
      },
    });
    loop.start();

    tick(0);
    expect(calls).toBe(1);
    expect(queue.length).toBe(1);

    tick(16);
    expect(calls).toBe(2);
    expect(queue.length).toBe(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('still runs the frame callback when a registered handler throws', () => {
    const onFrame = vi.fn();
    const loop = new RenderLoop({ onFrame });
    loop.rafManager.processFrame = () => {
      throw new Error('handler table broke');
    };
    loop.start();

    tick(0);
    tick(16);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(queue.length).toBe(1);
  });

  it('reports a fault that repeats every frame only once', () => {
    const loop = new RenderLoop({
      onFrame: () => {
        throw new Error('same every frame');
      },
    });
    loop.start();
    for (let i = 0; i < 10; i++) tick(i * 16);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(queue.length).toBe(1);
  });
});
