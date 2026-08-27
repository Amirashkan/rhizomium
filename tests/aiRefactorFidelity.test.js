import { describe, it, expect } from 'vitest';

/**
 * What a refactor gives back, and what it must not take away.
 *
 * The refactor is the one feature that writes over the canvas, and it can only
 * write back what it was shown. Two things were not surviving that round trip,
 * and neither showed up in any token budget:
 *
 *   A long shader body is sent as its first 2,000 characters and a comment
 *   saying the rest was cut. Measured on a patch built in the editor, a
 *   1,000-line custom node is 49KB of code of which 2KB travels. Writing that
 *   answer back replaces the artist's node with the fragment.
 *
 *   A node's name had nowhere to go in the answer schema at all, so every
 *   refactor stripped every name — including the ones the prompt asks the
 *   model to improve.
 *
 * Both are cheap in tokens, which is the point: the budgets say these patches
 * are small, and they are. The cost is the artist's work.
 */

const { refactorFit, truncatedParams, buildPatchContext, MAX_PARAM_CHARS, TRUNCATION_MARKER } =
  await import('../src/ai/patchContext.js');
const { replaceGraphWithPatch } = await import('../src/ai/applyResult.js');
const { validateGeneratedPatch } = await import('../api/_lib/nodeCatalog.js');
const { AI_FEATURES } = await import('../api/_lib/features.js');

/** A patch as the editor would save it, with a custom node of `lines` lines. */
function projectWithShader(lines) {
  const body = Array.from({ length: lines }, (_, i) => `  acc = acc + sin(uv.x * ${i}.0) * 0.01;`).join('\n');
  return {
    nodes: [
      { id: 'uv', kind: 'UV', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'shader',
        kind: 'CustomGLSL',
        position: { x: 220, y: 0 },
        name: 'the one I wrote myself',
        params: { code: body, inputCount: 1 },
      },
      { id: 'out', kind: 'OutputFinal', position: { x: 440, y: 0 }, params: {} },
    ],
    connections: [
      { from: { nodeId: 'uv', pin: 0 }, to: { nodeId: 'shader', pin: 0 } },
      { from: { nodeId: 'shader', pin: 0 }, to: { nodeId: 'out', pin: 0 } },
    ],
  };
}

describe('a custom node with more code than fits in one call', () => {
  it('is sent as a fragment, not in full', () => {
    const patch = buildPatchContext(projectWithShader(1000));
    const code = patch.nodes.find((n) => n.kind === 'CustomGLSL').params.code;

    expect(code.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(code.length).toBeLessThan(MAX_PARAM_CHARS + TRUNCATION_MARKER.length + 2);
    // The artist has far more than that on their canvas: a thousand lines is
    // around 39,000 characters, of which 2,000 travel.
    const onCanvas = projectWithShader(1000).nodes[1].params.code.length;
    expect(onCanvas).toBeGreaterThan(15 * MAX_PARAM_CHARS);
    expect(code.length / onCanvas).toBeLessThan(0.06);
  });

  it('is found by truncatedParams, so anything that writes back can check', () => {
    const patch = buildPatchContext(projectWithShader(1000));
    expect(truncatedParams(patch)).toEqual([{ id: 'shader', param: 'code' }]);
    expect(truncatedParams(buildPatchContext(projectWithShader(5)))).toEqual([]);
  });

  it('is warned about rather than refused, and told the code is safe', () => {
    // Three nodes and a few hundred tokens: every budget says yes, and the
    // warning has nothing to do with size. It is not a refusal because the
    // code is preserved on the way back in — so the only cost is that the
    // model is working from a fragment.
    const fit = refactorFit(buildPatchContext(projectWithShader(1000)));

    expect(fit.verdict).toBe('tight');
    expect(fit.reason).toBe('fidelity');
    expect(fit.answerTokens).toBeLessThan(2000);
    expect(fit.seconds).toBeLessThan(285);
    expect(fit.message).toMatch(/kept exactly as it is/i);
  });

  it('does not refuse a patch whose code fits', () => {
    const fit = refactorFit(buildPatchContext(projectWithShader(20)));
    expect(fit.verdict).toBe('fits');
    expect(fit.reason).toBeNull();
  });

  it('leaves the reading features alone', () => {
    // A review only reads. A shortened body costs it context, not the artist
    // their work, so refusing one would take away a feature for nothing.
    const patch = buildPatchContext(projectWithShader(1000));
    expect(patch.nodes).toHaveLength(3);
    expect(truncatedParams(patch)).toHaveLength(1);
    // Nothing in the review path consults refactorFit at all — asserted by the
    // panel test; here it is enough that the patch is built and usable.
    expect(patch.nodes.find((n) => n.kind === 'CustomGLSL').params.code).toContain('acc = acc +');
  });
});

describe('applying a refactor to a patch with a long shader body', () => {
  /** The canvas before the refactor, and what the import was handed. */
  function editorWith(nodes) {
    let imported = null;
    window.graph = { nodes, selection: new Set() };
    window.saveLoadManager = {
      createBackup: async () => {},
      importProject: async (data) => { imported = data; },
    };
    window.editor = { markDirty: () => {} };
    return () => imported;
  }

  const longCode = Array.from({ length: 1000 }, (_, i) => `  acc = acc + ${i}.0;`).join('\n');

  it('keeps the artist\'s code, not the fragment that came back', async () => {
    const imported = editorWith([
      { id: 'shader', kind: 'CustomGLSL', params: { code: longCode, inputCount: 1 } },
      { id: 'out', kind: 'OutputFinal', params: {} },
    ]);

    // What a refactor answers with: the code it was shown, which is the first
    // 2,000 characters and a comment.
    await replaceGraphWithPatch(
      {
        nodes: [
          { id: 'shader', kind: 'CustomGLSL', x: 0, y: 0, name: 'field', params: { code: `${longCode.slice(0, MAX_PARAM_CHARS)}\n${TRUNCATION_MARKER}`, inputCount: 1 } },
          { id: 'out', kind: 'OutputFinal', x: 220, y: 0, params: {} },
        ],
        connections: [],
      },
      { reason: 'ai-refactor', preserveLongParams: true }
    );

    const applied = imported().nodes.find((n) => n.id === 'shader');
    expect(applied.params.code).toBe(longCode);
    expect(applied.params.code).not.toContain(TRUNCATION_MARKER);
    // Everything else the refactor decided still lands.
    expect(applied.name).toBe('field');
    expect(applied.position).toEqual({ x: 0, y: 0 });
  });

  it('still lets the refactor change short parameters', async () => {
    const imported = editorWith([
      { id: 'shader', kind: 'CustomGLSL', params: { code: longCode, inputCount: 1 } },
      { id: 'out', kind: 'OutputFinal', params: {} },
    ]);

    await replaceGraphWithPatch(
      {
        nodes: [
          { id: 'shader', kind: 'CustomGLSL', x: 0, y: 0, params: { code: 'stub', inputCount: 3 } },
          { id: 'out', kind: 'OutputFinal', x: 220, y: 0, params: {} },
        ],
        connections: [],
      },
      { reason: 'ai-refactor', preserveLongParams: true }
    );

    const applied = imported().nodes.find((n) => n.id === 'shader');
    expect(applied.params.code).toBe(longCode);   // long: the artist's wins
    expect(applied.params.inputCount).toBe(3);    // short: the refactor's wins
  });

  it('does not hand an unrelated node someone else\'s code', async () => {
    // A generated patch can reuse an id. Matching on kind as well as id is what
    // stops a fresh node inheriting the code of whatever held that id before.
    const imported = editorWith([
      { id: 'shader', kind: 'CustomGLSL', params: { code: longCode } },
    ]);

    await replaceGraphWithPatch(
      {
        nodes: [
          { id: 'shader', kind: 'FBMNoise', x: 0, y: 0, params: {} },
          { id: 'out', kind: 'OutputFinal', x: 220, y: 0, params: {} },
        ],
        connections: [],
      },
      { reason: 'ai-refactor', preserveLongParams: true }
    );

    expect(imported().nodes[0].params.code).toBeUndefined();
  });

  it('leaves a generated patch alone, having nothing to preserve', async () => {
    const imported = editorWith([
      { id: 'shader', kind: 'CustomGLSL', params: { code: longCode } },
    ]);

    // The generator replaces the document with something new; there is no
    // previous version of these nodes to keep.
    await replaceGraphWithPatch(
      {
        nodes: [{ id: 'shader', kind: 'CustomGLSL', x: 0, y: 0, params: { code: 'brand new' } }],
        connections: [],
      },
      { reason: 'ai-generated' }
    );

    expect(imported().nodes[0].params.code).toBe('brand new');
  });
});

describe('the names on an artist\'s nodes', () => {
  it('have somewhere to go in the answer', () => {
    // The refactor prompt asks the model to "give nodes names that say what
    // they do". Without this property there is nowhere to put one.
    const schema = AI_FEATURES['ai.patch_refactor'].format.schema
      .properties.patch.properties.nodes.items;

    expect(Object.keys(schema.properties)).toContain('name');
    // Optional, not required: a generated patch may leave nodes unnamed.
    expect(schema.required).not.toContain('name');
  });

  it('survive validation on the way back', () => {
    const { patch } = validateGeneratedPatch({
      nodes: [
        { id: 'a', kind: 'UV', x: 0, y: 0, name: 'base coords', params: {} },
        { id: 'o', kind: 'OutputFinal', x: 220, y: 0, params: {} },
      ],
      connections: [{ from: { nodeId: 'a', pin: 0 }, to: { nodeId: 'o', pin: 0 } }],
    });

    expect(patch.nodes[0].name).toBe('base coords');
    // A node the model left unnamed stays unnamed rather than gaining an empty
    // string, which would render as a blank label on the canvas.
    expect('name' in patch.nodes[1]).toBe(false);
  });

  it('are not invented from whitespace', () => {
    const { patch } = validateGeneratedPatch({
      nodes: [
        { id: 'a', kind: 'UV', x: 0, y: 0, name: '   ', params: {} },
        { id: 'o', kind: 'OutputFinal', x: 220, y: 0, params: {} },
      ],
      connections: [],
    });

    expect('name' in patch.nodes[0]).toBe(false);
  });
});
