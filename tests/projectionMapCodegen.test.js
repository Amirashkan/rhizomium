// tests/projectionMapCodegen.test.js
//
// The ProjectionMap node is the mapping surfaces in the shader — which is what
// carries a mapping to the projector, since the output window re-renders the
// editor's broadcast WGSL. These cover what it emits.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import { MAX_MAPPED_SURFACES } from '../src/data/nodes/UtilityNodes.js';

function makeGraph(inputs, extraNodes = []) {
  return {
    nodes: [
      { id: '5', kind: 'Circle', params: { radius: 0.3 }, inputs: [] },
      ...extraNodes,
      // inputCount is what the canvas draws pins from and what the compiler
      // reads; assignSurfaceSource keeps the two in step, so a real node always
      // carries it alongside its inputs.
      { id: '12', kind: 'ProjectionMap', params: {}, inputs, inputCount: inputs.length },
      { id: '99', kind: 'OutputFinal', params: {}, inputs: ['12'] },
    ],
    connections: [],
  };
}

function compile(graph) {
  window.graph = graph;
  const result = buildWGSL(graph);
  return typeof result === 'string' ? result : (result.wgsl || result.code || '');
}

/** Balanced delimiters are the minimum bar for the WGSL not being a parse error. */
function isBalanced(text) {
  const pairs = [['(', ')'], ['{', '}']];
  return pairs.every(([o, c]) => (text.match(new RegExp(`\\${o}`, 'g')) || []).length
    === (text.match(new RegExp(`\\${c}`, 'g')) || []).length);
}

describe('ProjectionMap codegen', () => {
  beforeEach(() => {
    window.computeNodeRegistry = new Map();
  });

  afterEach(() => {
    delete window.graph;
    delete window.computeNodeRegistry;
    vi.restoreAllMocks();
  });

  it('emits one warp block per connected surface', () => {
    const wgsl = compile(makeGraph(['5']));
    expect(wgsl).toContain('// --- surface 1 ---');
    expect(wgsl).not.toContain('// --- surface 2 ---');
    expect(isBalanced(wgsl)).toBe(true);
  });

  it('warps by a uniform matrix rather than baking corners into the shader', () => {
    // A baked corner would mean recompiling on every mousemove of a drag, which
    // is the whole reason the homography is solved on the CPU.
    const wgsl = compile(makeGraph(['5']));
    for (let k = 0; k < 9; k++) {
      expect(wgsl).toContain(`u_params._12_s0m${k}`);
      expect(wgsl).toContain(`u_params._12_s0n${k}`);
    }
    expect(wgsl).toContain('u_params._12_s0opacity');
    expect(wgsl).toContain('u_params._12_s0soft');
  });

  it('divides through by w, so the warp is perspective and not affine', () => {
    const wgsl = compile(makeGraph(['5']));
    expect(wgsl).toMatch(/hd_12_s0\.xy \/ hd_12_s0\.z/);
    expect(wgsl).toMatch(/hs_12_s0\.xy \/ hs_12_s0\.z/);
    // A collapsed quad must not divide by zero.
    expect(wgsl).toContain('abs(hd_12_s0.z) > 1e-6');
  });

  it('clips each surface to its own quad', () => {
    const wgsl = compile(makeGraph(['5']));
    expect(wgsl).toContain('q_12_s0.x >= 0.0 && q_12_s0.x <= 1.0');
    expect(wgsl).toContain('q_12_s0.y >= 0.0 && q_12_s0.y <= 1.0');
  });

  it('feathers the edges only when a soft edge is asked for', () => {
    const wgsl = compile(makeGraph(['5']));
    expect(wgsl).toContain('smoothstep(0.0, soft_12_s0, q_12_s0.x)');
    expect(wgsl).toContain('if (soft_12_s0 > 0.0)');
  });

  it('gives every surface its own source, sampled as its own texture', () => {
    const graph = makeGraph(['5', '7'], [
      { id: '7', kind: 'ComputeNoise', params: {}, inputs: [] },
    ]);
    const wgsl = compile(graph);
    expect(wgsl).toContain('// --- surface 1 ---');
    expect(wgsl).toContain('// --- surface 2 ---');
    // Two different sources, so two different texture bindings.
    expect(wgsl).toContain('compute_node_5');
    expect(wgsl).toContain('compute_node_7');
    expect(isBalanced(wgsl)).toBe(true);
  });

  it('declares a binding for a fragment source bridged to a texture', () => {
    // A Circle is not a compute node; it reaches the surface through the
    // fragment bridge, published under its own id.
    const wgsl = compile(makeGraph(['5']));
    expect(wgsl).toMatch(/var compute_node_5: texture_2d<f32>/);
    expect(wgsl).toMatch(/var sampler_compute_node_5: sampler/);
  });

  it('binds a Texture2D source under its own texture pair instead of bridging it', () => {
    const graph = makeGraph(['8'], [
      { id: '8', kind: 'Texture2D', params: {}, inputs: [] },
    ]);
    const wgsl = compile(graph);
    expect(wgsl).toContain('texture_8');
    expect(wgsl).not.toContain('compute_node_8');
  });

  it('skips an empty pin rather than drawing a black surface over the rig', () => {
    // A mapping is routinely built one source at a time.
    const wgsl = compile(makeGraph([null, '5']));
    expect(wgsl).toContain('// --- surface 2 ---');
    expect(wgsl).not.toContain('// --- surface 1 ---');
    expect(isBalanced(wgsl)).toBe(true);
  });

  it('compiles to transparent black with nothing connected at all', () => {
    const wgsl = compile(makeGraph([]));
    expect(wgsl).toContain('var map_rgb_12 = vec3<f32>(0.0)');
    expect(wgsl).toContain('var map_a_12 = 0.0');
    expect(wgsl).toContain('let node_12 = vec4<f32>(map_rgb_12, map_a_12)');
    expect(isBalanced(wgsl)).toBe(true);
  });

  it('places surfaces in the top-down space their corners are stored in', () => {
    // in.uv is y-UP; a surface's corners are y-DOWN. Without converting once at
    // the top, a surface pinned to the top of the frame renders at the bottom —
    // the handles and the content mirror about the midline. The conversion has
    // to happen BEFORE the warp, not at the sample, or it only cancels out for a
    // full-frame surface and every partial one is misplaced.
    const wgsl = compile(makeGraph(['5']));
    expect(wgsl).toContain('let map_uv_12 = vec2<f32>(in.uv.x, 1.0 - in.uv.y)');
    // and nothing flips it back again on the way to the texture
    expect(wgsl).not.toMatch(/suv_12_s0 = vec2<f32>\(suv_12_s0\.x, 1\.0 - suv_12_s0\.y\)/);
  });

  it('samples at an explicit LOD, the only kind WGSL allows inside the clip test', () => {
    // The sample sits inside the surface's containment branch, which is
    // non-uniform control source; textureSample's implicit derivatives are
    // rejected there and the whole shader fails to compile.
    const wgsl = compile(makeGraph(['5']));
    expect(wgsl).toContain('textureSampleLevel(compute_node_5, sampler_compute_node_5, suv_12_s0, 0.0)');
    expect(wgsl).not.toMatch(/textureSample\(compute_node_5/);
  });

  it('composites surfaces back to front, matching the panel draw order', () => {
    const graph = makeGraph(['5', '7'], [
      { id: '7', kind: 'ComputeNoise', params: {}, inputs: [] },
    ]);
    const wgsl = compile(graph);
    // Later surfaces mix OVER what earlier ones left, so pin order is z-order.
    expect(wgsl.indexOf('// --- surface 1 ---')).toBeLessThan(wgsl.indexOf('// --- surface 2 ---'));
    expect(wgsl).toContain('map_rgb_12 = mix(map_rgb_12, texel_12_s0.rgb, a_12_s0)');
    expect(wgsl).toContain('map_rgb_12 = mix(map_rgb_12, texel_12_s1.rgb, a_12_s1)');
  });

  it('compiles only the surfaces the node shows a pin for', () => {
    // A surface compiled past the pin count would reach the projector with no
    // pin on the canvas to see or unwire it.
    const graph = makeGraph(['5', '5']);
    graph.nodes.find((n) => n.kind === 'ProjectionMap').inputCount = 1;
    const wgsl = compile(graph);
    expect(wgsl).toContain('// --- surface 1 ---');
    expect(wgsl).not.toContain('// --- surface 2 ---');
  });

  it('never emits more surfaces than the node can carry', () => {
    const pins = Array.from({ length: MAX_MAPPED_SURFACES + 3 }, () => '5');
    const wgsl = compile(makeGraph(pins));
    for (let i = 0; i < MAX_MAPPED_SURFACES; i++) {
      expect(wgsl).toContain(`// --- surface ${i + 1} ---`);
    }
    expect(wgsl).not.toContain(`// --- surface ${MAX_MAPPED_SURFACES + 1} ---`);
  });
});
