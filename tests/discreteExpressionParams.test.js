import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveDiscreteParam,
  resolveDiscreteParams,
  discreteExpressionSignature,
  hasDiscreteExpressionParams,
} from '../src/utils/discreteParams.js';
import { rectangleIsProportional } from '../src/codegen/compilers/FieldNodes.js';
import { TransformNodes } from '../src/codegen/compilers/TransformNodes.js';

// A dropdown or a true/false toggle can hold an expression like a numeric field can — but it does
// NOT reach the GPU the same way. A float rides in as a uniform or is compiled into the WGSL; a
// discrete control is BAKED into the generated code (a Flip2D's flipX becomes a literal -1.0, a
// Rectangle's sizeMode picks which half-extent goes into aspect space). So an expression in one has
// to be evaluated on the CPU and collapsed to a concrete option before the compiler branches on it,
// and the shader has to be rebuilt whenever that resolved option flips.

describe('resolveDiscreteParam', () => {
  it('leaves plain values untouched', () => {
    const node = { id: '1', kind: 'Flip2D', params: { flipX: true } };
    expect(resolveDiscreteParam(node, 'flipX', true)).toBe(true);
    expect(resolveDiscreteParam(node, 'flipX', false)).toBe(false);
  });

  it('leaves a NUMERIC parameter expression as text for the shader generator', () => {
    // Rectangle.width is a float: it must reach getShaderParam as "=..." so the expression is
    // compiled into the WGSL rather than frozen to whatever it evaluated to at compile time.
    const node = { id: '1', kind: 'Rectangle', params: { width: '=audioEnvelope' } };
    expect(resolveDiscreteParam(node, 'width', '=audioEnvelope')).toBe('=audioEnvelope');
  });

  it('resolves a boolean expression to true/false', () => {
    const node = { id: '1', kind: 'Flip2D', params: {} };
    expect(resolveDiscreteParam(node, 'flipX', '=1')).toBe(true);
    expect(resolveDiscreteParam(node, 'flipX', '=0')).toBe(false);
    expect(resolveDiscreteParam(node, 'flipX', '=2 > 1')).toBe(true);
    expect(resolveDiscreteParam(node, 'flipX', '=2 < 1')).toBe(false);
  });

  it('picks a select option by index', () => {
    const node = { id: '1', kind: 'Rectangle', params: {} };
    expect(resolveDiscreteParam(node, 'sizeMode', '=0')).toBe('Proportional');
    expect(resolveDiscreteParam(node, 'sizeMode', '=1')).toBe('Frame');
    // Out of range clamps rather than yielding undefined and killing the branch below it.
    expect(resolveDiscreteParam(node, 'sizeMode', '=9')).toBe('Frame');
  });

  it('prefers an option whose VALUE matches the number over its index', () => {
    // ComputeNoise.resolution is ['256','512','1024']: "=512" should mean 512, not index 512.
    const node = { id: '1', kind: 'ComputeNoise', params: {} };
    expect(resolveDiscreteParam(node, 'resolution', '=512')).toBe('512');
    expect(resolveDiscreteParam(node, 'resolution', '=1')).toBe('512'); // index form still works
  });

  it('falls back to the default when the expression cannot be resolved', () => {
    // An unknown identifier evaluates to leftover text; taking that as an option name would send
    // the compiler down whichever branch happened not to match.
    expect(resolveDiscreteParam({ id: '1', kind: 'Rectangle', params: {} }, 'sizeMode', '=nope_nope'))
      .toBe('Proportional');
    expect(resolveDiscreteParam({ id: '1', kind: 'Flip2D', params: {} }, 'flipX', '=nope_nope'))
      .toBe(false);
  });
});

describe('compilers read the resolved option', () => {
  it('Rectangle sizeMode honours an expression', () => {
    expect(rectangleIsProportional({ id: '1', kind: 'Rectangle', params: { sizeMode: '=1' } })).toBe(false);
    expect(rectangleIsProportional({ id: '1', kind: 'Rectangle', params: { sizeMode: '=0' } })).toBe(true);
    // Unchanged behaviour for plain values.
    expect(rectangleIsProportional({ id: '1', kind: 'Rectangle', params: { sizeMode: 'Frame' } })).toBe(false);
    expect(rectangleIsProportional({ id: '1', kind: 'Rectangle', params: {} })).toBe(true);
  });

  it('Flip2D flips when its boolean expression is true, and not when it is false', () => {
    const compiler = new TransformNodes();
    const getInput = () => 'in.uv';

    const flipped = compiler.compileFlip2D(
      { id: '3', kind: 'Flip2D', params: { flipX: '=1' }, inputs: [] }, getInput, '3'
    );
    expect(flipped.line).toContain('-1');

    const notFlipped = compiler.compileFlip2D(
      { id: '3', kind: 'Flip2D', params: { flipX: '=0' }, inputs: [] }, getInput, '3'
    );
    expect(notFlipped.line).not.toContain('-1');
  });
});

describe('discreteExpressionSignature', () => {
  it('only reports parameters that are BOTH discrete and expression-driven', () => {
    const node = {
      id: '4',
      kind: 'Rectangle',
      params: { width: '=audioEnvelope', sizeMode: '=1', roundness: 0.2, invert: true },
    };
    expect(hasDiscreteExpressionParams(node)).toBe(true);
    expect(discreteExpressionSignature(node)).toBe('sizeMode=Frame;');

    const plain = { id: '5', kind: 'Rectangle', params: { width: '=audioEnvelope', sizeMode: 'Frame' } };
    expect(hasDiscreteExpressionParams(plain)).toBe(false);
    expect(discreteExpressionSignature(plain)).toBe('');
  });
});

describe('resolveDiscreteParams (compute uniform packing)', () => {
  it('resolves discrete expressions and leaves everything else alone', () => {
    // computeUniformLayout maps option NAMES to indices and reads flags as truthy, so it must
    // never see "=..." text — a raw expression packs the default index and an always-on flag.
    const node = {
      id: '6',
      kind: 'ComputeBlur',
      params: { radius: '=audioEnvelope * 5', quality: '=2', direction: 'Horizontal' },
    };
    const resolved = resolveDiscreteParams(node);
    expect(resolved.quality).toBe('High');
    expect(resolved.direction).toBe('Horizontal');
    expect(resolved.radius).toBe('=audioEnvelope * 5');
    expect(node.params.quality).toBe('=2'); // the stored expression is not overwritten
  });

  it('returns the same object when there is nothing to resolve', () => {
    const node = { id: '7', kind: 'ComputeBlur', params: { radius: '=audioEnvelope', quality: 'Low' } };
    expect(resolveDiscreteParams(node)).toBe(node.params);
  });
});

describe('Editor.syncDiscreteExpressionParams', () => {
  // Poll-and-rebuild is what makes a live driver (audio, the clock) able to move a baked control
  // at all. It must fire ONLY on a flip: a rebuild per frame would stall the render loop, and a
  // rebuild on first sight would fire on every patch load.
  let editor;
  let reasons;
  let sourceValue;
  let previousEditor;

  beforeEach(async () => {
    const { Editor } = await import('../src/core/Editor.js');
    reasons = [];
    sourceValue = 0;

    const node = { id: '9', kind: 'Rectangle', params: { sizeMode: '=node_2 > 0.5' }, inputs: [] };
    const source = { id: '2', kind: 'Remap', params: {}, inputs: [] };
    Object.defineProperty(source, '__preview', { get: () => sourceValue, configurable: true });

    editor = Object.create(Editor.prototype);
    editor.graph = { nodes: [node, source] };
    editor.onChange = (reason) => reasons.push(reason);

    previousEditor = window.editor;
    window.editor = editor;
  });

  afterEach(() => {
    window.editor = previousEditor;
  });

  function poll() {
    editor._discreteExpressionCheckedAt = null; // skip the 100ms throttle
    editor.syncDiscreteExpressionParams();
  }

  it('does not rebuild on first sight or while the resolved option holds', () => {
    poll();
    poll();
    expect(reasons).toEqual([]);
  });

  it('rebuilds once when the resolved option flips', () => {
    poll();
    sourceValue = 1;
    poll();
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('Rectangle');

    poll(); // still Frame — no further rebuild
    expect(reasons).toHaveLength(1);

    sourceValue = 0;
    poll();
    expect(reasons).toHaveLength(2);
  });
});
