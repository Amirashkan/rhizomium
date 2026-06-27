// Regression test: the Resolution node's output-pin labels (and CPU preview) showed wrong
// numbers — NodeValueComputer had no "resolution" case, so it fell through to `default: 0`.
// The fix returns the live render dimensions [width, height], mirroring g.resolution which the
// GPU renderer writes from canvas.width/height each frame.

import { describe, it, expect, afterEach } from 'vitest';
import { NodeValueComputer } from '../src/core/preview/NodeValueComputer.js';

describe('NodeValueComputer resolves the Resolution node to live canvas dimensions', () => {
  const computer = new NodeValueComputer({ graph: { nodes: [], connections: [] } });

  afterEach(() => {
    delete globalThis.window;
  });

  it('returns [width, height] from the GPU renderer canvas', () => {
    globalThis.window = { gpuRenderer: { canvas: { width: 1920, height: 1080 } } };
    expect(computer.computeNodeValue({ id: 'r1', kind: 'Resolution', params: {} }))
      .toEqual([1920, 1080]);
  });

  it('falls back to [1, 1] when no renderer/canvas is available (instead of 0)', () => {
    globalThis.window = {};
    expect(computer.computeNodeValue({ id: 'r2', kind: 'Resolution', params: {} }))
      .toEqual([1, 1]);
  });
});
