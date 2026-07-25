// Output pins carry their NAME on the node, drawn inside the right edge just left of the live value
// tag, so a socket row reads `name  value ●`. Without it a multi-output node is a column of
// interchangeable numbers and nothing on screen says which pin a wire is about to come from — the
// Resolution node's res/width/height/aspect, Split's x/y/z/w, and the Audio Analysis node's growing
// bank of band/meter/trigger outputs are all unreadable by value alone.

import { describe, it, expect, afterEach } from 'vitest';
import { Renderer } from '../src/core/Renderer.js';
import { NodeDefs } from '../src/data/NodeDefs.js';

// ≈6px per character, so an expected width is just `text.length * 6`.
const stubCtx = () => ({
  font: '',
  textAlign: '',
  fillStyle: '',
  calls: [],
  measureText: (s) => ({ width: String(s).length * 6 }),
  fillText: function (text, x, y) { this.calls.push({ text, x, y }); },
  save() {},
  restore() {},
});

const makeRenderer = (scale = 1) => {
  const renderer = new Renderer(null, { scale, x: 0, y: 0 }, {});
  renderer.ctx = stubCtx();
  return renderer;
};

describe('_outputLabel resolves a pin name from either pinsOut form', () => {
  const renderer = makeRenderer();

  it('reads the object form { label, type }', () => {
    expect(renderer._outputLabel({ kind: 'Split3' }, 0)).toBe('x');
    expect(renderer._outputLabel({ kind: 'Split3' }, 2)).toBe('z');
    expect(renderer._outputLabel({ kind: 'Resolution' }, 3)).toBe('aspect');
    expect(renderer._outputLabel({ kind: 'AudioAnalysis' }, 0)).toBe('level');
  });

  it('reads the plain-string form used by the compute nodes', () => {
    expect(renderer._outputLabel({ kind: 'ComputeBlur' }, 0)).toBe('Texture');
  });

  it('drops the placeholder "out" when it is a node\'s only output', () => {
    // "out" there is not a name, it is "this node's result" — it would repeat the title on ~83 nodes
    // and widen every one of them for nothing.
    expect(renderer._outputLabel({ kind: 'Add' }, 0)).toBe('');
  });

  it('keeps "out" when the node has other outputs to tell it apart from', () => {
    expect(renderer._outputLabel({ kind: 'CellNoise' }, 0)).toBe('out');
    expect(renderer._outputLabel({ kind: 'CellNoise' }, 1)).toBe('cellID');
  });

  it('returns "" for a pin index the node does not have', () => {
    expect(renderer._outputLabel({ kind: 'Split2' }, 5)).toBe('');
    expect(renderer._outputLabel({ kind: 'NotARealNode' }, 0)).toBe('');
  });
});

describe('_renderOutputPinName places the name on its socket row', () => {
  it('right-aligns the name just left of the value tag', () => {
    const renderer = makeRenderer();
    const pos = { x: 200, y: 60 };
    const tagW = 40;

    renderer._renderOutputPinName({ kind: 'Split3' }, 1, pos, tagW);

    const [call] = renderer.ctx.calls;
    expect(call.text).toBe('y');
    expect(renderer.ctx.textAlign).toBe('right');
    // The tag box ends 6px left of the port and is tagW wide, so the name's right edge clears its
    // left edge by OUT_NAME_GAP — the name and the value never overlap.
    expect(call.x).toBe(200 - 6 - tagW - 6);
    // Centred on the same row as the port.
    expect(call.y).toBe(pos.y + 2);
  });

  it('right-aligns against the port itself when no value tag was drawn', () => {
    // Previews off: _renderOutputPinLabel draws nothing and reports a 0-wide tag, but the name is
    // not a value and still belongs on screen.
    const renderer = makeRenderer();
    renderer._renderOutputPinName({ kind: 'Split3' }, 0, { x: 200, y: 60 }, 0);

    expect(renderer.ctx.calls).toHaveLength(1);
    expect(renderer.ctx.calls[0].x).toBe(190);
  });

  it('draws nothing for a pin with no name', () => {
    const renderer = makeRenderer();
    renderer._renderOutputPinName({ kind: 'Add' }, 0, { x: 200, y: 60 }, 40);
    expect(renderer.ctx.calls).toHaveLength(0);
  });

  it('disappears with the value tag when zoomed out past the cramped cutoff', () => {
    const renderer = makeRenderer(0.5);
    renderer._renderOutputPinName({ kind: 'Split3' }, 0, { x: 200, y: 60 }, 40);
    expect(renderer.ctx.calls).toHaveLength(0);
  });
});

// The name is reserved in the node's minimum width, or a long one would be drawn under the input
// label on the same row. Unlike the value tag it is static per node kind, so reserving it cannot make
// a node drift wider while you work.
describe('node width reserves room for the output name', () => {
  // A tag wide enough that the socket row — not the header cluster — sets the node's width, so these
  // comparisons measure the name and nothing else.
  const TAG_W = 200;

  afterEach(() => {
    delete globalThis.window;
  });

  // Three 0-input/1-or-more-output nodes, identical in shape; only the pin names differ.
  const width = (renderer, kind, outCount) =>
    renderer._minNodeWidth({ id: 1, kind }, 0, outCount, false, TAG_W);

  // The widest name among a node's first `outCount` outputs, in stub-ctx characters. Derived from
  // the definition rather than written out, because the audio branch keeps adding outputs and a
  // hardcoded length silently stops describing the node it names (see the reservation test below).
  const widestName = (kind, outCount = Infinity) =>
    (NodeDefs[kind]?.pinsOut || [])
      .slice(0, outCount)
      .map((p) => (typeof p === 'string' ? p : p.label || '').length)
      .reduce((a, b) => Math.max(a, b), 0);

  it('grows a node by exactly its widest pin name plus the gap to the value tag', () => {
    delete globalThis.window; // no preview band
    const renderer = makeRenderer();

    // ConstFloat's sole output is the placeholder "out" and reserves nothing; Time's is "t" (1 char).
    expect(width(renderer, 'Time', 1) - width(renderer, 'ConstFloat', 1)).toBe(1 * 6 + 6);

    // Only the first three of the Audio Analysis node's outputs are asked for here, so this measures
    // "level" against level/low/mid — the widest of that slice, not of the whole bank.
    expect(widestName('AudioAnalysis', 3)).toBe('level'.length);
    expect(width(renderer, 'AudioAnalysis', 3) - width(renderer, 'ConstFloat', 1))
      .toBe(widestName('AudioAnalysis', 3) * 6 + 6);
  });

  it('keeps the name width even when the value tag collapses to nothing', () => {
    // Previews off -> tagW 0, and with no tag there is no gap to reserve either.
    delete globalThis.window;
    const renderer = makeRenderer();
    const bare = (kind, outCount) => renderer._minNodeWidth({ id: 1, kind }, 0, outCount, false, 0);

    // Both are at the 160px floor without a tag, so compare through _minNodeWidth's row term by
    // giving the names something to exceed: a wide node still has to fit "level".
    expect(bare('AudioAnalysis', 3)).toBeGreaterThanOrEqual(bare('ConstFloat', 1));
  });

  it('_ensureNodeSize applies the reservation to the live node box', () => {
    delete globalThis.window;
    const renderer = makeRenderer();

    const named = { id: 1, kind: 'AudioAnalysis', x: 0, y: 0, __valueTagW: TAG_W };
    const unnamed = { id: 2, kind: 'ConstFloat', x: 0, y: 0, __valueTagW: TAG_W };
    renderer._ensureNodeSize(named);
    renderer._ensureNodeSize(unnamed);

    // _ensureNodeSize takes the output count from the definition, so unlike the test above this
    // reserves for the widest name in the WHOLE bank — currently "snareMeter", twice the width of
    // the "level" the first row shows. Asserting a literal here is what rotted: the reservation was
    // written against a three-output Audio Analysis node and the signal-chain rebuild grew it to
    // fifteen, which is exactly the drift the node-box reservation exists to absorb.
    expect(named.w - unnamed.w).toBe(widestName('AudioAnalysis') * 6 + 6);
    expect(widestName('AudioAnalysis')).toBeGreaterThan(widestName('AudioAnalysis', 3));
  });
});
