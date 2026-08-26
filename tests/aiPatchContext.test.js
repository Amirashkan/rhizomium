import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildPatchContext,
  measurePatchContext,
  EmptyPatchError,
  PatchTooLargeError,
  MAX_NODES,
} from '../src/ai/patchContext.js';
import { checkOutputFeature, requireOutputFeature } from '../src/ai/outputGating.js';
import { entitlements } from '../src/ai/entitlements.js';

/**
 * What leaves the artist's machine, and the licence check on the local output
 * features.
 */

describe('buildPatchContext', () => {
  it('keeps the graph and the artist\'s own node names', () => {
    const context = buildPatchContext({
      nodes: [
        { id: 1, kind: 'UV', position: { x: 10.4, y: 20.6 }, name: 'base coords' },
        { id: 2, kind: 'OutputFinal', position: { x: 240, y: 20 } },
      ],
      connections: [{ from: { nodeId: 1, pin: 0 }, to: { nodeId: 2, pin: 0 } }],
    });

    expect(context.nodeCount).toBe(2);
    expect(context.nodes[0]).toMatchObject({ id: '1', kind: 'UV', x: 10, y: 21, name: 'base coords' });
    expect(context.connections[0].from.nodeId).toBe('1');
  });

  it('never sends embedded texture data', () => {
    const context = buildPatchContext({
      nodes: [
        { id: 1, kind: 'Texture2D', params: { image: 'data:image/png;base64,AAAAAAAA' } },
        { id: 2, kind: 'OutputFinal' },
      ],
      connections: [],
    });

    expect(context.nodes[0].params.image).toBe('<embedded data>');
  });

  it('sends a custom shader body but truncates a runaway one', () => {
    const short = 'return input0 * 2.0;';
    const long = 'x'.repeat(5000);

    const context = buildPatchContext({
      nodes: [
        { id: 1, kind: 'CustomGLSL', params: { code: short } },
        { id: 2, kind: 'CustomGLSL', params: { code: long } },
        { id: 3, kind: 'OutputFinal' },
      ],
      connections: [],
    });

    expect(context.nodes[0].params.code).toBe(short);
    expect(context.nodes[1].params.code).toContain('truncated');
    expect(context.nodes[1].params.code.length).toBeLessThan(2100);
  });

  it('keeps short vectors but summarizes sample data', () => {
    const context = buildPatchContext({
      nodes: [
        { id: 1, kind: 'Const', params: { colour: [1, 0, 0.5, 1], samples: new Array(512).fill(0) } },
        { id: 2, kind: 'OutputFinal' },
      ],
      connections: [],
    });

    expect(context.nodes[0].params.colour).toEqual([1, 0, 0.5, 1]);
    expect(context.nodes[0].params.samples).toBe('<512 values>');
  });

  it('refuses an empty canvas before any quota is spent', () => {
    expect(() => buildPatchContext({ nodes: [] })).toThrow(EmptyPatchError);
    expect(() => buildPatchContext(undefined)).toThrow(EmptyPatchError);
  });

  it('refuses a patch too large to read rather than truncating it', () => {
    const nodes = new Array(MAX_NODES + 1).fill(null).map((_, i) => ({ id: i, kind: 'UV' }));
    expect(() => buildPatchContext({ nodes })).toThrow(PatchTooLargeError);
  });
});

/**
 * The panel's "Selection" scope. A review of one branch of a large patch has
 * to be a coherent patch on its own — a wire pointing at a node the model was
 * never shown reads as a broken document rather than a partial one.
 */
describe('buildPatchContext scoped to a selection', () => {
  const project = {
    nodes: [
      { id: 1, kind: 'UV' },
      { id: 2, kind: 'Noise' },
      { id: 3, kind: 'OutputFinal' },
    ],
    connections: [
      { from: { nodeId: 1, pin: 0 }, to: { nodeId: 2, pin: 0 } },
      { from: { nodeId: 2, pin: 0 }, to: { nodeId: 3, pin: 0 } },
    ],
  };

  it('keeps only the selected nodes and the wires between them', () => {
    const context = buildPatchContext(project, { nodeIds: [1, 2] });

    expect(context.nodeCount).toBe(2);
    expect(context.nodes.map((node) => node.id)).toEqual(['1', '2']);
    expect(context.connections).toHaveLength(1);
    expect(context.scope).toBe('selection');
  });

  it('matches ids whatever type they arrive as', () => {
    expect(buildPatchContext(project, { nodeIds: ['1'] }).nodeCount).toBe(1);
    expect(buildPatchContext(project, { nodeIds: [1] }).nodeCount).toBe(1);
  });

  it('refuses an empty selection before any quota is spent', () => {
    expect(() => buildPatchContext(project, { nodeIds: [] })).toThrow(EmptyPatchError);
    expect(() => buildPatchContext(project, { nodeIds: ['nope'] })).toThrow(EmptyPatchError);
  });

  it('leaves the whole patch alone when no selection is given', () => {
    expect(buildPatchContext(project).scope).toBe('patch');
    expect(buildPatchContext(project).connections).toHaveLength(2);
  });
});

/**
 * What the panel shows before anything is spent. These are estimates and are
 * drawn as estimates; what matters is that they move with the payload.
 */
describe('measurePatchContext', () => {
  it('counts what is there and sizes what would be sent', () => {
    const context = buildPatchContext({
      nodes: [
        { id: 1, kind: 'UV' },
        { id: 2, kind: 'UV' },
        { id: 3, kind: 'OutputFinal' },
      ],
      connections: [{ from: { nodeId: 1, pin: 0 }, to: { nodeId: 3, pin: 0 } }],
    });

    const measured = measurePatchContext(context);
    expect(measured.nodeCount).toBe(3);
    expect(measured.connectionCount).toBe(1);
    expect(measured.kindCount).toBe(2); // UV twice, OutputFinal once
    expect(measured.bytes).toBeGreaterThan(0);
    expect(measured.approxTokens).toBe(Math.round(measured.bytes / 4));
    expect(measured.capacity).toBeCloseTo(3 / MAX_NODES);
  });

  it('survives being handed nothing at all', () => {
    expect(measurePatchContext(undefined).nodeCount).toBe(0);
    expect(measurePatchContext(null).connectionCount).toBe(0);
  });
});

describe('unmetered output feature gate', () => {
  beforeEach(() => {
    entitlements.entitlements = null;
  });

  it('refuses when the live answer says the tier is too low', () => {
    entitlements.entitlements = {
      authenticated: true,
      tier: 'cloude',
      tierLabel: 'Cloude',
      features: ['ai.patch_generator'],
      catalog: [],
      upgradeUrl: 'https://art.tenderworld.org/pricing',
      degraded: false,
    };

    const check = checkOutputFeature('output.multiscreen');
    expect(check.allowed).toBe(false);
    expect(check.requiredTierLabel).toBe('Cloude Plus');

    const refusals = [];
    expect(requireOutputFeature('output.multiscreen', { onRefused: (m) => refusals.push(m) })).toBe(false);
    expect(refusals[0]).toMatch(/Cloude Plus/);
  });

  it('allows when the live answer grants it', () => {
    entitlements.entitlements = {
      authenticated: true,
      tier: 'cloude_plus',
      features: ['output.multiscreen', 'output.ndi'],
      catalog: [],
      degraded: false,
    };

    expect(checkOutputFeature('output.multiscreen').allowed).toBe(true);
    expect(requireOutputFeature('output.ndi')).toBe(true);
  });

  it('allows rather than refuses when there is no live answer', () => {
    // Deliberate asymmetry: these cost the operator nothing and are used live,
    // so a network blip must not black out a projector mid-show.
    entitlements.entitlements = null;

    const check = checkOutputFeature('output.multiscreen');
    expect(check.allowed).toBe(true);
    expect(check.reason).toBe('entitlements_unavailable');
  });
});
