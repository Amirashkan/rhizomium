// What the AI features know about the editor they are working in.
//
// The node registry was the whole of it: kinds, pins, parameter names. That is
// enough to wire nodes together and nothing like enough to use the editor. A
// model reading it had no way to know that "ComputeFieldMapper" is the 3D
// support (its kind does not say so, its canvas label does), that a numeric
// parameter takes "=time*30" and moves every frame, that a fragment chain can
// feed a compute node, or that a Mix can have six inputs. So generated patches
// came back as static graphs of Math nodes: correct, and a fraction of what
// the artist has.
//
// These tests hold the two halves of the fix together — the catalogue that
// describes the nodes and the capability notes that describe the editor — and
// check that what the prompt promises is what the code actually does.

import { describe, it, expect } from 'vitest';
import { NodeDefs } from '../src/data/NodeDefs.js';
import { unifiedExpressionSystem } from '../src/utils/UnifiedExpressionSystem.js';
import { nodeCatalogText, validateGeneratedPatch } from '../api/_lib/nodeCatalog.js';
import { featureConfig } from '../api/_lib/features.js';
import { replaceGraphWithPatch } from '../src/ai/applyResult.js';
import { getInputCount } from '../src/data/nodeInputs.js';
import { hydrateNodes } from '../src/core/graphHydration.js';

const catalog = nodeCatalogText();
const generatorPrompt = featureConfig('ai.patch_generator').system();

/** The catalogue line for one kind, without the description line under it. */
function lineFor(kind) {
  return catalog.split('\n').find((line) => line.startsWith(`${kind} [`)) ?? '';
}

describe('the node catalogue', () => {
  it('gives a node its name on the canvas when the kind does not say what it is', () => {
    // The one that started this: nothing in "ComputeFieldMapper" says 3D.
    expect(lineFor('ComputeFieldMapper')).toContain('"3D Field Visualizer"');
    expect(lineFor('Expr')).toContain('"Expression"');
    // And no noise where the label is the kind again.
    expect(lineFor('Circle')).not.toContain('"Circle"');
  });

  it('states the range a parameter is clamped to', () => {
    // A value outside it is a control the artist finds pinned at one end.
    expect(lineFor('ComputeFieldMapper')).toContain('resolution:int=96[8..256]');
    expect(lineFor('ComputeParticles')).toContain('particleCount:int=10000[1000..100000]');
  });

  it('passes on what the node file says a parameter is for', () => {
    // "depth" on a particle system is the pseudo-3D control. Four letters do
    // not say that, and the node file already explains it.
    expect(lineFor('ComputeParticles')).toContain('{Pseudo-3D:');
  });

  it('leaves out the parameters nothing a model writes could fill in', () => {
    // ProjectionMap's corner coordinates are dragged by hand and are 362 of
    // the registry's 738 parameters; a font is a file from the artist's disk.
    expect(lineFor('ProjectionMap')).not.toContain('d6x');
    expect(catalog).not.toContain('fontData');
  });

  it('marks the nodes whose pin count can be changed', () => {
    expect(lineFor('CustomGLSL')).toContain('dynamic-in(1-8)');
    expect(lineFor('ComputeMix')).toContain('dynamic-in(2-8)');
  });

  it('is still deterministic, and still fits behind the cache breakpoint', () => {
    expect(nodeCatalogText()).toBe(catalog);
    expect(catalog).not.toContain('[object Object]');
    // ~5,400 tokens at four bytes to a token. The budget test in
    // aiFeatureTokenCost.test.js owns the real ceiling; this is a tripwire for
    // a registry that has doubled without anyone noticing.
    expect(Math.ceil(catalog.length / 4)).toBeLessThan(6500);
  });
});

describe('what the features are told the editor can do', () => {
  it('describes the parameter expressions that make a patch move', () => {
    expect(generatorPrompt).toContain('"rotateY": "=time*30"');
    expect(generatorPrompt).toMatch(/Only numeric parameters take one/);
  });

  it('promises only variables the expression system actually resolves', () => {
    // A name the shader generator cannot map is how a generated patch comes
    // back with one parameter silently stuck at zero: the identifier fails and
    // generateShader() falls back to "0.0" for that parameter alone.
    const promised = [
      'time',
      'audioEnvelope',
      'audioEnvelopeBass',
      'audioEnvelopeMids',
      'audioEnvelopeHighs',
      'audioEnvelopeFull',
      'aspect',
      'PI',
      'E',
    ];

    for (const name of promised) {
      expect(generatorPrompt).toContain(name);
      expect(unifiedExpressionSystem.generateShader(`=${name}`)).not.toBe('0.0');
    }

    // The same check on a name nobody promised, so the assertion above is
    // known to be able to fail.
    expect(unifiedExpressionSystem.generateShader('=tim')).toBe('0.0');
  });

  it('promises only functions the expression system actually resolves', () => {
    // Read out of the prompt itself rather than restated here: the drift this
    // catches is the list in the prompt growing past what the generator maps.
    const line = generatorPrompt.split('\n').find((text) => text.startsWith('Functions:'));
    const named = line.slice('Functions:'.length).split(',')[0].trim().split(/\s+/);

    expect(named.length).toBeGreaterThan(20);

    for (const name of named) {
      const call = `=${name}(${ARGUMENTS_FOR[name] ?? '0.5'})`;
      expect(unifiedExpressionSystem.generateShader(call), name).not.toBe('0.0');
    }
  });

  it('points at the node that does 3D, and at what it is not', () => {
    expect(generatorPrompt).toContain('ComputeFieldMapper');
    expect(generatorPrompt).toMatch(/mode=surface/);
    expect(generatorPrompt).toMatch(/mode=instances/);
    // The mapper's own output is a colour texture, which is what puts the 3D
    // on the main canvas — a generated 3D patch with nothing wired into
    // OutputFinal is refused by validateGeneratedPatch().
    expect(generatorPrompt).toContain('OutputFinal');
  });

  it('says how compute and fragment nodes mix, since neither needs a bridge', () => {
    expect(generatorPrompt).toMatch(/no bridging node/);
  });

  it('tells a feature how to ask for more pins', () => {
    expect(generatorPrompt).toContain('inputCount');
  });
});

/**
 * Arguments to call each promised function with, where one of anything will
 * not do. Only the arity matters: the generator maps names to WGSL and leaves
 * the type checking to the shader compiler.
 */
const ARGUMENTS_FOR = {
  atan2: '0.5, 0.5',
  pow: '0.5, 2.0',
  min: '0.5, 1.0',
  max: '0.5, 1.0',
  mod: '0.5, 1.0',
  step: '0.5, 1.0',
  distance: '0.5, 1.0',
  dot: '0.5, 1.0',
  clamp: '0.5, 0.0, 1.0',
  smoothstep: '0.0, 1.0, 0.5',
  lerp: '0.0, 1.0, 0.5',
};

describe('a generated patch that uses those capabilities', () => {
  const output = { id: 'out', kind: 'OutputFinal', x: 880, y: 0, params: {} };

  it('keeps an expression on a numeric parameter', () => {
    const { patch } = validateGeneratedPatch({
      nodes: [
        { id: 'field', kind: 'ComputeFieldMapper', x: 0, y: 0, params: { rotateY: '=time*30', mode: 'instances' } },
        output,
      ],
      connections: [{ from: { nodeId: 'field', pin: 0 }, to: { nodeId: 'out', pin: 0 } }],
    });

    expect(patch.nodes[0].params.rotateY).toBe('=time*30');
    expect(patch.nodes[0].params.mode).toBe('instances');
  });

  it('drops a select value the node has no branch for', () => {
    const { patch } = validateGeneratedPatch({
      nodes: [
        { id: 'field', kind: 'ComputeFieldMapper', x: 0, y: 0, params: { mode: '=time > 1 ? "surface" : "instances"' } },
        output,
      ],
      connections: [],
    });

    // A select is compiled as a branch, not evaluated per frame. Left off, the
    // node runs at its default and renders something.
    expect(patch.nodes[0].params.mode).toBeUndefined();
  });

  it('carries the pin count of a node whose pins are adjustable', () => {
    const { patch } = validateGeneratedPatch({
      nodes: [
        { id: 'a', kind: 'FBMNoise', x: 0, y: 0, params: {} },
        { id: 'mix', kind: 'ComputeMix', x: 220, y: 0, inputCount: 5, params: {} },
        output,
      ],
      connections: [{ from: { nodeId: 'mix', pin: 0 }, to: { nodeId: 'out', pin: 0 } }],
    });

    const mix = patch.nodes.find((node) => node.id === 'mix');
    expect(mix.inputCount).toBe(5);
    expect(getInputCount({ kind: 'ComputeMix', inputCount: mix.inputCount })).toBe(5);
  });

  it('clamps a pin count the node cannot have, and ignores one on a node that has no choice', () => {
    const { patch } = validateGeneratedPatch({
      nodes: [
        { id: 'mix', kind: 'ComputeMix', x: 0, y: 0, inputCount: 40, params: {} },
        { id: 'add', kind: 'Add', x: 220, y: 0, inputCount: 6, params: {} },
        output,
      ],
      connections: [],
    });

    expect(patch.nodes[0].inputCount).toBe(NodeDefs.ComputeMix.dynamicInputs.max);
    expect(patch.nodes[1].inputCount).toBeUndefined();
  });

  it('grows the pin count to cover the wires that were drawn', () => {
    // The failure this prevents: the wire into pin 4 survives validation, and
    // then the node opens on the canvas with the two pins its definition
    // declares and the wire goes nowhere.
    const { patch, warnings } = validateGeneratedPatch({
      nodes: [
        { id: 'a', kind: 'FBMNoise', x: 0, y: 0, params: {} },
        { id: 'mix', kind: 'ComputeMix', x: 220, y: 0, params: {} },
        output,
      ],
      connections: [
        { from: { nodeId: 'a', pin: 0 }, to: { nodeId: 'mix', pin: 4 } },
        { from: { nodeId: 'mix', pin: 0 }, to: { nodeId: 'out', pin: 0 } },
      ],
    });

    const mix = patch.nodes.find((node) => node.id === 'mix');
    expect(mix.inputCount).toBe(5);
    expect(patch.connections).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it('still refuses a wire to a pin the node could never have', () => {
    const { patch, warnings } = validateGeneratedPatch({
      nodes: [
        { id: 'a', kind: 'FBMNoise', x: 0, y: 0, params: {} },
        { id: 'mix', kind: 'ComputeMix', x: 220, y: 0, params: {} },
        output,
      ],
      connections: [{ from: { nodeId: 'a', pin: 0 }, to: { nodeId: 'mix', pin: 12 } }],
    });

    expect(patch.connections).toHaveLength(0);
    expect(warnings[0]).toMatch(/no input pin 12/);
  });

  it('keeps the pin types a generated CustomGLSL body was written against', () => {
    // inputTypes is read by the compiler and declared by no node file. Without
    // it a body that swizzles a vec2 pin is handed a scalar and the shader
    // fails to compile.
    const { patch } = validateGeneratedPatch({
      nodes: [
        {
          id: 'code',
          kind: 'CustomGLSL',
          x: 0,
          y: 0,
          inputCount: 2,
          params: {
            code: 'input0.x * input1',
            outputType: 'f32',
            inputTypes: ['vec2', 'f32'],
            invented: 'nonsense',
          },
        },
        output,
      ],
      connections: [{ from: { nodeId: 'code', pin: 0 }, to: { nodeId: 'out', pin: 0 } }],
    });

    expect(patch.nodes[0].params.inputTypes).toEqual(['vec2', 'f32']);
    expect(patch.nodes[0].params.invented).toBeUndefined();
  });
});

describe('applying such a patch to the canvas', () => {
  it('lands the pin count where the editor reads it', async () => {
    let imported = null;
    window.graph = { nodes: [], selection: new Set() };
    window.saveLoadManager = {
      createBackup: async () => {},
      importProject: async (data) => { imported = data; },
    };
    window.editor = { markDirty: () => {} };

    const { patch } = validateGeneratedPatch({
      nodes: [
        { id: 'a', kind: 'FBMNoise', x: 0, y: 0, params: {} },
        { id: 'mix', kind: 'ComputeMix', x: 220, y: 0, inputCount: 4, params: {} },
        { id: 'out', kind: 'OutputFinal', x: 440, y: 0, params: {} },
      ],
      connections: [
        { from: { nodeId: 'a', pin: 0 }, to: { nodeId: 'mix', pin: 3 } },
        { from: { nodeId: 'mix', pin: 0 }, to: { nodeId: 'out', pin: 0 } },
      ],
    });

    await replaceGraphWithPatch(patch, { title: 'Four-way mix', reason: 'ai-patch' });

    const saved = imported.nodes.find((node) => node.id === 'mix');
    expect(saved.inputCount).toBe(4);

    // And survives the hydration the editor and the viewer both load through.
    const hydrated = hydrateNodes(imported.nodes).find((node) => node.id === 'mix');
    expect(getInputCount(hydrated)).toBe(4);
  });

  it('mirrors a written expression onto the field the Expression node reads', async () => {
    // A patch saved by the editor carries "expr" twice: in params, and in the
    // field applyNodeParameterValue() mirrors it onto. A patch written by the
    // model carries only params, and the Expression node's compiler reads
    // node.expr alone — so without the mirror in hydrateNodes() a generated
    // Expr node comes back holding its default "a".
    const hydrated = hydrateNodes([
      { id: 'e', kind: 'Expr', position: { x: 0, y: 0 }, params: { expr: 'a * sin(b * time)' } },
      { id: 'c', kind: 'CustomGLSL', position: { x: 220, y: 0 }, params: { code: 'input0 * 2.0' } },
    ]);

    expect(hydrated[0].expr).toBe('a * sin(b * time)');
    expect(hydrated[1].code).toBe('input0 * 2.0');
  });

  it('leaves a fixed-pin node with nothing to carry', async () => {
    let imported = null;
    window.graph = { nodes: [], selection: new Set() };
    window.saveLoadManager = {
      createBackup: async () => {},
      importProject: async (data) => { imported = data; },
    };
    window.editor = { markDirty: () => {} };

    await replaceGraphWithPatch(
      { nodes: [{ id: 'out', kind: 'OutputFinal', x: 0, y: 0, params: {} }], connections: [] },
      { reason: 'ai-patch' }
    );

    expect(Object.hasOwn(imported.nodes[0], 'inputCount')).toBe(false);
  });
});
