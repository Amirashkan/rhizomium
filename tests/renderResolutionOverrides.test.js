// The single render-resolution store must not override a context that legitimately renders at
// its own size. The second-monitor receiver runs its OWN ComputeExecutor in a separate window and
// registers every node with the viewer display's dimensions (node.computeResolution / the
// registry's `resolution`), which is what makes "Auto (display)" and the fixed 720/1080/1440/2048
// viewer modes independent of the editor.
//
// The store is a per-document module reading localStorage at load, so in that window it would
// hand back the EDITOR's setting - stale and wrong for the viewer. Explicit per-node dimensions
// therefore win; the store is only the fallback.

import { describe, it, expect, afterEach } from 'vitest';
import { ComputeNodes } from '../src/codegen/compilers/ComputeNodes.js';
import { setOutputFormat, resetOutputFormat } from '../src/ui/OutputFormat.js';

describe('per-node resolution overrides beat the shared render resolution', () => {
  afterEach(() => resetOutputFormat('test'));

  it('follows the render resolution when a node has no override', () => {
    setOutputFormat(1920, 1080, 'test');
    expect(new ComputeNodes().getResolution({ params: {} })).toEqual([1920, 1080]);
  });

  it('uses the node override (the second-monitor viewer\'s own dims) when present', () => {
    setOutputFormat(1920, 1080, 'test');
    const node = { params: {}, computeResolution: [1280, 720] };
    expect(new ComputeNodes().getResolution(node)).toEqual([1280, 720]);
  });

  it('ignores a malformed override rather than rendering at zero', () => {
    setOutputFormat(800, 600, 'test');
    expect(new ComputeNodes().getResolution({ params: {}, computeResolution: [0, 0] }))
      .toEqual([800, 600]);
    expect(new ComputeNodes().getResolution({ params: {}, computeResolution: [] }))
      .toEqual([800, 600]);
  });
});
