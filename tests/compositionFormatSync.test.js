// Regression test: changing the output format must reach the graph, not just the canvas.
//
// Bug: "no thumbnail gets updated at the res change moment." OutputFormat owns the
// composition's shape, but the things that rasterise it are built once and cached — a
// compute node's output texture is sized inside ComputeExecutor.initialize(), and a node
// thumbnail's shape comes from whichever texture it was last read back from. Nothing about
// a node changes when the composition is resized, so no parameter/connection/graph event
// would ever invalidate them: the new ratio only appeared on some later, unrelated edit,
// and then only for the nodes that edit happened to touch. That is why a Pattern picked up
// the ratio when it was wired to the output (a rebuild resized its compute texture) while
// Circle/Rectangle/Polygon kept the old one until a node was dropped on the canvas.
//
// Contract: an "output" or "simQuality" change runs one coalesced pass that rebuilds the
// graph FIRST (resizing the compute textures) and then re-renders every thumbnail.

import { describe, it, expect, vi } from 'vitest';
import { startCompositionFormatSync } from '../src/core/CompositionFormatSync.js';

/** Stand-in for OutputFormat's subscriber list, so tests can emit changes directly. */
function makeBus() {
  const listeners = new Set();
  return {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit: (change) => listeners.forEach((fn) => fn(change)),
    get count() { return listeners.size; },
  };
}

const flush = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('composition format changes reach the graph', () => {
  it('rebuilds and then refreshes thumbnails on an output change', async () => {
    const bus = makeBus();
    const order = [];
    const stop = startCompositionFormatSync({
      subscribe: bus.subscribe,
      delay: 1,
      rebuild: async () => { order.push('rebuild'); },
      refreshThumbnails: () => { order.push('refresh'); },
    });

    bus.emit({ kind: 'output', roles: ['output', 'preview', 'sim', 'export'] });
    await flush(20);

    // Thumbnails read the textures the rebuild resizes, so the order is the contract.
    expect(order).toEqual(['rebuild', 'refresh']);
    stop();
  });

  it('applies a sim quality change too - it resizes the very textures thumbnails read', async () => {
    const bus = makeBus();
    const refresh = vi.fn();
    const stop = startCompositionFormatSync({
      subscribe: bus.subscribe, delay: 1, rebuild: vi.fn(), refreshThumbnails: refresh,
    });

    bus.emit({ kind: 'simQuality', roles: ['sim'] });
    await flush(20);

    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ignores machine-local knobs that leave the graph textures alone', async () => {
    const bus = makeBus();
    const rebuild = vi.fn();
    const stop = startCompositionFormatSync({
      subscribe: bus.subscribe, delay: 1, rebuild, refreshThumbnails: vi.fn(),
    });

    bus.emit({ kind: 'previewQuality', roles: ['preview'] });
    bus.emit({ kind: 'exportTarget', roles: ['export'] });
    await flush(20);

    expect(rebuild).not.toHaveBeenCalled();
    stop();
  });

  it('coalesces a burst into one pass - typing a width and a height is two changes', async () => {
    const bus = makeBus();
    const rebuild = vi.fn();
    const refresh = vi.fn();
    const stop = startCompositionFormatSync({
      subscribe: bus.subscribe, delay: 5, rebuild, refreshThumbnails: refresh,
    });

    bus.emit({ kind: 'output', roles: ['output'] });
    bus.emit({ kind: 'output', roles: ['output'] });
    bus.emit({ kind: 'simQuality', roles: ['sim'] });
    await flush(30);

    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('runs a follow-up pass for a change that lands while one is still applying', async () => {
    const bus = makeBus();
    let release;
    const started = [];
    const rebuild = vi.fn(() => {
      started.push(Date.now());
      return started.length === 1 ? new Promise((r) => { release = r; }) : Promise.resolve();
    });
    const refresh = vi.fn();
    const stop = startCompositionFormatSync({
      subscribe: bus.subscribe, delay: 1, rebuild, refreshThumbnails: refresh,
    });

    bus.emit({ kind: 'output', roles: ['output'] });
    await flush(10);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled(); // still inside the first rebuild

    // A second resize while the first pass is mid-rebuild must not interleave with it.
    bus.emit({ kind: 'output', roles: ['output'] });
    await flush(10);
    expect(rebuild).toHaveBeenCalledTimes(1);

    release();
    await flush(30);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('still refreshes thumbnails when the rebuild fails', async () => {
    const bus = makeBus();
    const refresh = vi.fn();
    const stop = startCompositionFormatSync({
      subscribe: bus.subscribe,
      delay: 1,
      rebuild: () => Promise.reject(new Error('shader compilation failed')),
      refreshThumbnails: refresh,
    });

    bus.emit({ kind: 'output', roles: ['output'] });
    await flush(20);

    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stop() unsubscribes and cancels a pending pass', async () => {
    const bus = makeBus();
    const rebuild = vi.fn();
    const stop = startCompositionFormatSync({
      subscribe: bus.subscribe, delay: 10, rebuild, refreshThumbnails: vi.fn(),
    });

    bus.emit({ kind: 'output', roles: ['output'] });
    stop();
    await flush(40);

    expect(rebuild).not.toHaveBeenCalled();
    expect(bus.count).toBe(0);
  });
});
