// tests/projectionMapNode.test.js
//
// The node is the mapping the panel edits, projected onto what the GPU reads.
// These cover that projection: that the geometry arrives as uniforms rather than
// a recompile, and that wiring a surface's own source behaves.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  findProjectionMapNode,
  ensureProjectionMapNode,
  surfaceParamValues,
  mappingParamValues,
  syncMappingToNode,
  guideParamValues,
  syncGuidesToNode,
  uploadParameters,
  getSurfaceSource,
  assignSurfaceSource,
  sourceLabel,
} from '../src/mapping/projectionMapNode.js';
import { MappingModel, rectQuad, resetSurfaceIdCounter } from '../src/mapping/MappingModel.js';
import { MAX_MAPPED_SURFACES, MAX_MASK_POINTS } from '../src/data/nodes/UtilityNodes.js';
import { getInputCount } from '../src/data/nodeInputs.js';
import { applyMat3 } from '../src/mapping/homography.js';

const makeNode = (over = {}) => ({ id: '12', kind: 'ProjectionMap', params: {}, inputs: [], ...over });

describe('findProjectionMapNode', () => {
  it('finds the node and tolerates a graph without one', () => {
    const node = makeNode();
    expect(findProjectionMapNode({ nodes: [{ id: '1', kind: 'Circle' }, node] })).toBe(node);
    expect(findProjectionMapNode({ nodes: [{ id: '1', kind: 'Circle' }] })).toBeNull();
    expect(findProjectionMapNode(null)).toBeNull();
    expect(findProjectionMapNode({})).toBeNull();
  });
});


describe('ensureProjectionMapNode', () => {
  it('returns the node the graph already has', () => {
    const node = makeNode();
    const graph = { nodes: [node] };
    expect(ensureProjectionMapNode(graph)).toBe(node);
    expect(graph.nodes).toHaveLength(1);
  });

  it('creates one on demand, so a drop never fails for an invisible reason', () => {
    const graph = { nodes: [{ id: '5', kind: 'Circle', params: {}, inputs: [] }] };
    const created = ensureProjectionMapNode(graph, { x: 40, y: 80 });
    expect(created).not.toBeNull();
    expect(created.kind).toBe('ProjectionMap');
    expect(graph.nodes).toContain(created);
  });

  it('never mints an id that already exists in the graph', () => {
    // The shared id counter can be behind a graph this session did not build —
    // after a load, say. A collision would silently alias another node.
    resetSurfaceIdCounter(1);
    const graph = { nodes: [{ id: '5', kind: 'Circle', params: {}, inputs: [] }] };
    const created = ensureProjectionMapNode(graph);
    expect(String(created.id)).not.toBe('5');
    expect(graph.nodes.filter((n) => String(n.id) === String(created.id))).toHaveLength(1);
  });

  it('declines a graph that cannot hold a node', () => {
    expect(ensureProjectionMapNode(null)).toBeNull();
    expect(ensureProjectionMapNode({})).toBeNull();
  });
});

describe('surfaceParamValues', () => {
  beforeEach(() => resetSurfaceIdCounter(1));

  it('carries the matrices that map output space onto the surface', () => {
    const model = new MappingModel();
    const dst = [{ x: 0.2, y: 0.1 }, { x: 0.9, y: 0.25 }, { x: 0.8, y: 0.9 }, { x: 0.05, y: 0.7 }];
    const surface = model.addSurface({ dst });

    const values = surfaceParamValues(surface, 0);
    const m = Array.from({ length: 9 }, (_, k) => values[`s0m${k}`]);

    // Each destination corner must land on the matching corner of the unit
    // square — that is what makes the shader's clip test the surface's outline.
    const unit = rectQuad(0, 0, 1, 1);
    dst.forEach((corner, i) => {
      const q = applyMat3(m, corner.x, corner.y);
      expect(q.x).toBeCloseTo(unit[i].x, 9);
      expect(q.y).toBeCloseTo(unit[i].y, 9);
    });
  });

  it('carries the crop matrix for the source it samples', () => {
    const model = new MappingModel();
    const surface = model.addSurface({ src: rectQuad(0.25, 0.5, 0.5, 0.5) });
    const values = surfaceParamValues(surface, 2);
    const n = Array.from({ length: 9 }, (_, k) => values[`s2n${k}`]);
    expect(applyMat3(n, 0, 0)).toEqual({ x: 0.25, y: 0.5 });
  });

  it('falls back to the identity for a collapsed quad instead of emitting garbage', () => {
    const collapsed = {
      enabled: true, opacity: 1, softEdge: 0,
      dst: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
      src: rectQuad(0, 0, 1, 1),
    };
    const values = surfaceParamValues(collapsed, 0);
    expect([values.s0m0, values.s0m4, values.s0m8]).toEqual([1, 1, 1]);
  });

  it('mutes a hidden surface by opacity, keeping it a uniform write', () => {
    // Dropping the pin instead would change the shader's structure and force a
    // recompile in the middle of a session.
    const model = new MappingModel();
    const surface = model.addSurface();
    model.updateSurface(surface.id, { opacity: 0.8 });
    expect(surfaceParamValues(surface, 0).s0opacity).toBe(0.8);
    model.updateSurface(surface.id, { enabled: false });
    expect(surfaceParamValues(surface, 0).s0opacity).toBe(0);
  });

  it('passes the feather width through', () => {
    const model = new MappingModel();
    const surface = model.addSurface();
    model.updateSurface(surface.id, { softEdge: 0.12 });
    expect(surfaceParamValues(surface, 0).s0soft).toBeCloseTo(0.12);
  });
});

describe('mappingParamValues', () => {
  beforeEach(() => resetSurfaceIdCounter(1));

  it('covers every pin the node can carry', () => {
    const model = new MappingModel();
    model.addSurface();
    const values = mappingParamValues(model);
    // 9 + 9 matrix, opacity, soft edge, mask count, and MAX_MASK_POINTS x/y,
    // plus the one surface count shared by the whole mapping.
    const perSurface = 9 + 9 + 3 + MAX_MASK_POINTS * 2;
    expect(Object.keys(values)).toHaveLength(MAX_MAPPED_SURFACES * perSurface + 1);
  });

  it('carries the surface count, which the pin count cannot stand in for', () => {
    // The guides are drawn per surface, and a surface with no source of its own
    // has no pin — which is exactly the surface whose outline matters most.
    const model = new MappingModel();
    model.addSurface();
    model.addSurface();
    expect(mappingParamValues(model).sn).toBe(2);
    expect(mappingParamValues(new MappingModel()).sn).toBe(0);
  });

  it('mutes pins beyond the mapping, so a removed surface leaves the projector', () => {
    const model = new MappingModel();
    model.addSurface();
    const values = mappingParamValues(model);
    expect(values.s0opacity).toBe(1);
    expect(values.s1opacity).toBe(0);
    expect(values.s5opacity).toBe(0);
  });
});

describe('syncMappingToNode', () => {
  let uniformManager;
  let renderer;

  beforeEach(() => {
    resetSurfaceIdCounter(1);
    uniformManager = { uniformValues: new Map() };
    renderer = { _updateParameterUniforms: vi.fn(), render: vi.fn() };
    vi.stubGlobal('window', { renderLoop: { getState: () => ({ running: true }) } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('writes the geometry to both the node and the uniform buffer', () => {
    const model = new MappingModel();
    model.addSurface({ dst: rectQuad(0.1, 0.1, 0.5, 0.5) });
    const node = makeNode();

    expect(syncMappingToNode(model, node, { uniformManager, renderer })).toBe(true);
    expect(node.params.s0m0).toBeCloseTo(2, 6); // a half-width quad halves in the inverse
    expect(uniformManager.uniformValues.get('12.s0m0')).toBeCloseTo(2, 6);
  });

  it('uploads the buffer once for the whole mapping, not once per parameter', () => {
    // A drag writes 120 parameters per mousemove; one upload is the difference
    // between a usable alignment and a slideshow.
    const model = new MappingModel();
    model.addSurface();
    syncMappingToNode(model, makeNode(), { uniformManager, renderer });
    expect(renderer._updateParameterUniforms).toHaveBeenCalledTimes(1);
  });

  it('treats the axes as structural too, since they are code and not a value', () => {
    const node = makeNode();
    const uniformManager = { uniformValues: new Map() };
    const renderer = { _updateParameterUniforms: vi.fn(), render: vi.fn() };
    vi.stubGlobal('window', { renderLoop: { getState: () => ({ running: true }) } });

    syncGuidesToNode(node, { guides: true }, { uniformManager, renderer });
    expect(syncGuidesToNode(node, { guides: true, axes: true }, { uniformManager, renderer })).toBe(true);
    expect(node.params.axes).toBe(1);
    expect(syncGuidesToNode(node, { guides: true, axes: false }, { uniformManager, renderer })).toBe(true);
    vi.unstubAllGlobals();
  });

  it('can write the values and leave the upload to the caller', () => {
    // A mouse reports faster than the screen refreshes. Uploading the whole
    // buffer on every report — and forcing a frame with it, when the render
    // loop is stopped — is what makes the ghost trail the hand.
    const node = makeNode();
    const uniformManager = { uniformValues: new Map() };
    const renderer = { _updateParameterUniforms: vi.fn(), render: vi.fn() };
    vi.stubGlobal('window', { renderLoop: { getState: () => ({ running: false }) } });

    syncGuidesToNode(node, {
      guides: true, cursor: { x: 0.25, y: 0.75 },
    }, { uniformManager, renderer, deferUpload: true });

    expect(node.params.dcx).toBeCloseTo(0.25);
    expect(uniformManager.uniformValues.get('12.dcy')).toBeCloseTo(0.75);
    expect(renderer._updateParameterUniforms).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();

    uploadParameters(renderer);
    expect(renderer._updateParameterUniforms).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('does nothing when the geometry has not moved', () => {
    const model = new MappingModel();
    model.addSurface();
    const node = makeNode();
    expect(syncMappingToNode(model, node, { uniformManager, renderer })).toBe(true);
    expect(syncMappingToNode(model, node, { uniformManager, renderer })).toBe(false);
    expect(renderer._updateParameterUniforms).toHaveBeenCalledTimes(1);
  });

  it('draws a frame itself when the render loop is stopped', () => {
    vi.stubGlobal('window', { renderLoop: { getState: () => ({ running: false, simTime: 4.5 }) } });
    const model = new MappingModel();
    model.addSurface();
    syncMappingToNode(model, makeNode(), { uniformManager, renderer });
    expect(renderer.render).toHaveBeenCalledWith({ timeSec: 4.5 });
  });

  it('leaves the running loop to present the change', () => {
    const model = new MappingModel();
    model.addSurface();
    syncMappingToNode(model, makeNode(), { uniformManager, renderer });
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('ignores anything that is not a ProjectionMap node', () => {
    const model = new MappingModel();
    model.addSurface();
    expect(syncMappingToNode(model, { id: '3', kind: 'Circle' }, { uniformManager })).toBe(false);
    expect(syncMappingToNode(null, makeNode(), { uniformManager })).toBe(false);
  });

  it('works before any renderer exists', () => {
    const model = new MappingModel();
    model.addSurface();
    expect(() => syncMappingToNode(model, makeNode(), {})).not.toThrow();
  });
});

describe('surface sources', () => {
  const makeGraph = (nodes = []) => ({ nodes, connections: [] });

  it('reports the source feeding a surface, or none', () => {
    const node = makeNode({ inputs: ['7', null, '9'] });
    expect(getSurfaceSource(node, 0)).toBe('7');
    expect(getSurfaceSource(node, 1)).toBeNull();
    expect(getSurfaceSource(node, 2)).toBe('9');
    expect(getSurfaceSource(node, 5)).toBeNull();
  });

  it('assigns a source, growing the pins to reach the surface', () => {
    const node = makeNode();
    const graph = makeGraph([node]);
    expect(assignSurfaceSource(graph, node, 2, '7')).toBe(true);
    // Pins are positional: reaching surface 3 means 1 and 2 exist, empty.
    expect(node.inputs).toEqual([null, null, '7']);
    // The node must SHOW three pins. Everything that draws, hit-tests and
    // validates a pin reads inputCount, and a connection landing past it is
    // pruned as out of range — so a grown inputs array alone is invisible.
    expect(getInputCount(node)).toBe(3);
  });

  it('records the connection the canvas draws, not just the compiler input', () => {
    // A connection lives in graph.connections AND the target's inputs. Writing
    // only the second renders correctly but leaves no wire on the canvas and
    // nothing for save/load or undo to see.
    const node = makeNode();
    const graph = makeGraph([node]);
    assignSurfaceSource(graph, node, 0, '7');
    expect(graph.connections).toEqual([
      { from: { nodeId: '7', pin: 0 }, to: { nodeId: '12', pin: 0 } },
    ]);
  });

  it('replaces the wire when a surface is re-fed rather than stacking them', () => {
    const node = makeNode();
    const graph = makeGraph([node]);
    assignSurfaceSource(graph, node, 0, '7');
    assignSurfaceSource(graph, node, 0, '9');
    expect(graph.connections).toHaveLength(1);
    expect(graph.connections[0].from.nodeId).toBe('9');
    expect(node.inputs[0]).toBe('9');
  });

  it('leaves other surfaces\' wires alone', () => {
    const node = makeNode();
    const graph = makeGraph([node]);
    assignSurfaceSource(graph, node, 0, '7');
    assignSurfaceSource(graph, node, 1, '9');
    expect(graph.connections).toHaveLength(2);
    assignSurfaceSource(graph, node, 0, null);
    expect(graph.connections).toEqual([
      { from: { nodeId: '9', pin: 0 }, to: { nodeId: '12', pin: 1 } },
    ]);
  });

  it('clears a source so the surface falls back to the composition', () => {
    const node = makeNode({ inputs: ['7'] });
    const graph = makeGraph([node]);
    expect(assignSurfaceSource(graph, node, 0, null)).toBe(true);
    expect(node.inputs[0]).toBeNull();
    expect(graph.connections).toEqual([]);
  });

  it('reports when the wiring did not change', () => {
    const node = makeNode({ inputs: ['7'], inputCount: 1 });
    const graph = makeGraph([node]);
    expect(assignSurfaceSource(graph, node, 0, '7')).toBe(false);
  });

  it('still grows the pins when the input was already set but no pin showed it', () => {
    // A project saved before the pin count was maintained would otherwise stay
    // stuck with an invisible connection.
    const node = makeNode({ inputs: [null, null, '7'] });
    const graph = makeGraph([node]);
    expect(assignSurfaceSource(graph, node, 2, '7')).toBe(true);
    expect(getInputCount(node)).toBe(3);
  });

  it('refuses a self-feeding cycle the compiler could not resolve', () => {
    const node = makeNode();
    const graph = makeGraph([node]);
    expect(assignSurfaceSource(graph, node, 0, '12')).toBe(false);
    expect(node.inputs).toEqual([]);
    expect(graph.connections).toEqual([]);
  });

  it('refuses a surface beyond what the node carries', () => {
    const node = makeNode();
    const graph = makeGraph([node]);
    expect(assignSurfaceSource(graph, node, MAX_MAPPED_SURFACES, '7')).toBe(false);
    expect(assignSurfaceSource(graph, node, -1, '7')).toBe(false);
  });

  it('works on a graph with no connection list', () => {
    const node = makeNode();
    expect(assignSurfaceSource({ nodes: [node] }, node, 0, '7')).toBe(true);
    expect(node.inputs[0]).toBe('7');
  });
});

describe('sourceLabel', () => {
  it('uses the name the node shows in the graph, not its kind', () => {
    expect(sourceLabel({ id: '4', kind: 'ComputeNoise' })).toBe('Compute Noise');
    expect(sourceLabel({ id: '5', kind: 'ComputeGradient' })).toBe('Gradient');
  });

  it('prefers a node the user renamed', () => {
    expect(sourceLabel({ id: '4', kind: 'ComputeNoise', name: 'Backdrop' })).toBe('Backdrop');
  });

  it('falls back to the kind for a node with no definition', () => {
    expect(sourceLabel({ id: '4', kind: 'Mystery' })).toBe('Mystery');
    expect(sourceLabel(null)).toBe('');
  });
});

describe('setup visuals', () => {
  const makeGraph = (nodes = []) => ({ nodes, connections: [] });

  it('carries the outline being drawn and the point the next click would place', () => {
    const values = guideParamValues({
      guides: true,
      draft: [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 }],
      cursor: { x: 0.5, y: 0.9 },
    });
    expect(values.guides).toBe(1);
    expect(values.dn).toBe(2);
    expect(values.d0x).toBeCloseTo(0.2);
    expect(values.d1x).toBeCloseTo(0.8);
    expect(values.dcOn).toBe(1);
    expect(values.dcy).toBeCloseTo(0.9);
  });

  it('blanks the slots past the outline, so an old point cannot linger', () => {
    const values = guideParamValues({ guides: true, draft: [{ x: 0.4, y: 0.4 }] });
    expect(values.dn).toBe(1);
    expect(values.d1x).toBe(0);
    expect(values.dcOn).toBe(0);
  });

  it('never sends more points than the shader has slots', () => {
    const draft = Array.from({ length: MAX_MASK_POINTS + 4 }, (_, i) => ({ x: i / 20, y: 0.5 }));
    expect(guideParamValues({ draft }).dn).toBe(MAX_MASK_POINTS);
  });

  it('reports a rebuild only when the guides are switched, not when they move', () => {
    // Turning them on changes what the shader CONTAINS; moving the cursor is a
    // buffer write, and rebuilding per mousemove would make drawing unusable.
    const node = makeNode();
    const uniformManager = { uniformValues: new Map() };
    const renderer = { _updateParameterUniforms: vi.fn(), render: vi.fn() };
    vi.stubGlobal('window', { renderLoop: { getState: () => ({ running: true }) } });

    expect(syncGuidesToNode(node, { guides: true }, { uniformManager, renderer })).toBe(true);
    expect(syncGuidesToNode(node, {
      guides: true, cursor: { x: 0.5, y: 0.5 },
    }, { uniformManager, renderer })).toBe(false);
    expect(uniformManager.uniformValues.get('12.dcx')).toBeCloseTo(0.5);
    vi.unstubAllGlobals();
  });

  it('does nothing when the geometry has not moved', () => {
    const node = makeNode();
    const uniformManager = { uniformValues: new Map() };
    vi.stubGlobal('window', { renderLoop: { getState: () => ({ running: true }) } });
    syncGuidesToNode(node, { guides: true }, { uniformManager });
    expect(syncGuidesToNode(node, { guides: true }, { uniformManager })).toBe(false);
    vi.unstubAllGlobals();
  });

  it('ignores anything that is not a ProjectionMap node', () => {
    expect(syncGuidesToNode({ id: '3', kind: 'Circle' }, { guides: true })).toBe(false);
    expect(syncGuidesToNode(null, { guides: true })).toBe(false);
    expect(makeGraph()).toBeTruthy();
  });
});
