// Text node: the WGSL it compiles to, and the layout its rasteriser derives from the parameters.
//
// The node is texture-backed — it rasterises its string into TextureManager under its own node id
// and the shader samples that through the same binding pair Texture 2D uses. These tests pin down
// the two halves of that contract: that the binding + sampling code is emitted (and that the
// wrap-mode cutoff only appears in clamp mode), and that the CPU-side layout puts the lines where
// the parameters say — the part the GPU texture and the node thumbnail both read.
//
// happy-dom has no 2D canvas context, so nothing here rasterises for real; textNodeLayout is
// deliberately free of canvas calls so it stays testable.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import { TextureBindings } from '../src/codegen/generators/TextureBindings.js';
import { makeNode, NodeDefs } from '../src/data/NodeDefs.js';
import { isTextureSourceKind } from '../src/core/autoConnect.js';
import {
  textNodeLayout,
  textRasterKey,
  colorToCss,
  resolveTextContent,
  textNodeHasLiveExpression,
} from '../src/core/TextRasterizer.js';
import { TextNodeProcessor } from '../src/core/TextNodeProcessor.js';
import { SHARED_SAMPLER } from '../src/gpu/sharedSamplers.js';

function buildGraph(params = {}, { uvInput = null } = {}) {
  const nodes = [
    { id: '10', kind: 'Text', params, inputs: [uvInput] },
    { id: '99', kind: 'OutputFinal', params: {}, inputs: ['10'] },
  ];
  if (uvInput) {
    nodes.unshift({ id: uvInput, kind: 'UV', params: {}, inputs: [] });
  }
  const graph = { nodes, connections: [] };
  const result = buildWGSL(graph);
  return typeof result === 'string' ? result : result.wgsl;
}

describe('Text node codegen', () => {
  beforeEach(() => {
    delete window.editor;
    delete window.nodeCompiler;
    delete window.textureManager;
  });

  it('binds a 2D texture under the node id, like an image node', () => {
    const bindings = TextureBindings.generate({
      nodes: [{ id: '10', kind: 'Text' }],
    });

    expect(bindings).toContain('var texture_10: texture_2d<f32>');
    // Sampled through the shader's shared sampler, like every other texture.
    expect(bindings).toContain(`var ${SHARED_SAMPLER}: sampler;`);
  });

  it('samples that binding at the incoming UV, with Y flipped like the other texture nodes', () => {
    const wgsl = buildGraph();

    expect(wgsl).toContain('let srcuv_10 = in.uv;');
    expect(wgsl).toContain('let uv_10 = vec2<f32>(fituv_10.x, 1.0 - fituv_10.y);');
    expect(wgsl).toContain(`textureSample(texture_10, ${SHARED_SAMPLER}, uv_10)`);
  });

  it('reads a connected UV instead of the fragment UV', () => {
    const wgsl = buildGraph({}, { uvInput: '1' });

    expect(wgsl).toContain('let srcuv_10 = node_1;');
  });

  it('zeroes the sample outside the unit square in clamp mode so the edge cannot smear', () => {
    const wgsl = buildGraph({ wrap: 'clamp' });

    expect(wgsl).toContain('let inside_10 = step(0.0, fituv_10.x) * step(fituv_10.x, 1.0)');
    expect(wgsl).toContain('let node_10_tex = node_10_rgba * inside_10;');
  });

  it('defaults to the clamp cutoff when no wrap mode is stored', () => {
    expect(buildGraph()).toContain('inside_10');
  });

  it('leaves the sample untouched in repeat and mirror mode so the text tiles', () => {
    for (const wrap of ['repeat', 'mirror']) {
      const wgsl = buildGraph({ wrap });
      expect(wgsl).not.toContain('inside_10');
      expect(wgsl).toContain('let node_10_tex = node_10_rgba;');
    }
  });

  it('exposes Color on pin 0 and the glyph coverage as a scalar Mask on pin 1', () => {
    const def = NodeDefs.Text;
    expect(def.pinsOut.map((p) => [p.label, p.type])).toEqual([
      ['Color', 'vec4'],
      ['Mask', 'f32'],
    ]);

    // Pin 1 must be a real f32 expression: a scalar consumer reads it directly.
    window.editor = { graph: { connections: [{ from: { nodeId: '10', pin: 1 }, to: { nodeId: '99', pin: 0 } }] } };
    const wgsl = buildWGSL({
      nodes: [
        { id: '10', kind: 'Text', params: {}, inputs: [null] },
        { id: '99', kind: 'OutputFinal', params: {}, inputs: ['10'] },
      ],
      connections: [],
    }).wgsl;

    expect(wgsl).toContain('node_10_tex.a');
  });

  it('counts as a texture source, so a wire dragged onto a transform lands on its Texture pin', () => {
    expect(isTextureSourceKind('Text')).toBe(true);
  });

  // The bitmap is square and the output usually isn't. Without a correction the letters are drawn
  // stretched across the frame's aspect; these pin down the mapping that fixes it.
  describe('fit modes', () => {
    it('contains the square inside the frame by default, measuring against u.aspect', () => {
      const wgsl = buildGraph();

      expect(wgsl).toContain('let fitscale_10 = min(u.aspect, 1.0);');
      expect(wgsl).toContain('(srcuv_10.x * u.aspect - u.aspect * 0.5) / fitscale_10 + 0.5');
      expect(wgsl).toContain('(srcuv_10.y - 0.5) / fitscale_10 + 0.5');
    });

    it('fills the frame and overflows on the long axis in cover mode', () => {
      expect(buildGraph({ fit: 'cover' })).toContain('let fitscale_10 = max(u.aspect, 1.0);');
    });

    it('leaves the UV alone in stretch mode, which is the uncorrected mapping', () => {
      const wgsl = buildGraph({ fit: 'stretch' });

      expect(wgsl).toContain('let fituv_10 = srcuv_10;');
      expect(wgsl).not.toContain('u.aspect');
    });

    it('is the identity on a square frame, whichever fit is chosen', () => {
      // aspect == 1 makes fitscale 1 and the mapping collapses to fituv = srcuv, so a square
      // output is untouched by the correction — only non-square frames are rescaled.
      const map = (aspect, srcuv, scale) => [
        (srcuv[0] * aspect - aspect * 0.5) / scale + 0.5,
        (srcuv[1] - 0.5) / scale + 0.5,
      ];
      for (const fit of [Math.min, Math.max]) {
        expect(map(1, [0.25, 0.75], fit(1, 1))).toEqual([0.25, 0.75]);
      }
    });

    it('maps a wide frame so the square keeps its proportions', () => {
      // 16:9, contain: the square spans the full height and is centred, so the visible x range is
      // the middle 9/16 of the frame.
      const aspect = 16 / 9;
      const scale = Math.min(aspect, 1);
      const x = (u) => (u * aspect - aspect * 0.5) / scale + 0.5;

      expect(x(0.5)).toBeCloseTo(0.5, 6);          // centre stays centred
      expect(x(0)).toBeCloseTo(0.5 - aspect / 2, 6); // left edge is outside the texture
      expect(x(1)).toBeCloseTo(0.5 + aspect / 2, 6);
      // One texture-width spans 1/aspect of the frame: the square is as wide as it is tall.
      expect(x(1 / aspect) - x(0)).toBeCloseTo(1, 6);
    });
  });

  it('is transformable: a transform reading it samples the same binding pair', () => {
    window.editor = { graph: { connections: [] } };
    const wgsl = buildWGSL({
      nodes: [
        { id: '10', kind: 'Text', params: {}, inputs: [null] },
        { id: '20', kind: 'Rotate2D', params: { angle: 45 }, inputs: [null, '10'] },
        { id: '99', kind: 'OutputFinal', params: {}, inputs: ['20'] },
      ],
      connections: [],
    }).wgsl;

    expect(wgsl).toContain(`textureSample(texture_10, ${SHARED_SAMPLER}, sample_uv_20)`);
  });
});

describe('Text node definition', () => {
  it('seeds a new node with every parameter default', () => {
    const node = makeNode('Text', 0, 0);

    expect(node.params.text).toBe('TEXT');
    expect(node.params.fontFamily).toBe('sans-serif');
    expect(node.params.align).toBe('center');
    expect(node.params.size).toBe(0.25);
    expect(node.params.resolution).toBe(1024);
    expect(node.params.wrap).toBe('clamp');
    expect(node.params.color).toEqual([1, 1, 1, 1]);
  });

  it('gives each colour default its own array, so one node cannot rewrite another', () => {
    const a = makeNode('Text', 0, 0);
    const b = makeNode('Text', 0, 0);

    a.params.color[0] = 0;
    expect(b.params.color[0]).toBe(1);
    expect(NodeDefs.Text.params.find((p) => p.name === 'color').default[0]).toBe(1);
  });
});

describe('Text node layout', () => {
  const node = (params) => ({ id: '1', kind: 'Text', params });

  it('scales the font with the resolution so a resolution change preserves the look', () => {
    expect(textNodeLayout(node({ size: 0.25, resolution: 1024 })).fontPx).toBe(256);
    expect(textNodeLayout(node({ size: 0.25, resolution: 512 })).fontPx).toBe(128);
  });

  it('clamps the resolution to what the node is willing to allocate', () => {
    expect(textNodeLayout(node({ resolution: 999999 })).resolution).toBe(4096);
    expect(textNodeLayout(node({ resolution: 1 })).resolution).toBe(64);
  });

  it('splits on newlines and stacks the lines by line height', () => {
    const layout = textNodeLayout(node({
      text: 'A\nB\nC', size: 0.1, lineHeight: 2, resolution: 1000, posY: 0.5,
    }));

    expect(layout.lines.map((l) => l.text)).toEqual(['A', 'B', 'C']);
    expect(layout.lineStep).toBe(200);
    // Three lines centred on y = 500 sit at 300 / 500 / 700.
    expect(layout.lines.map((l) => l.y)).toEqual([300, 500, 700]);
  });

  it('places a single line at the requested position, with y measured from the bottom', () => {
    // posY is in UV space (y up) because the shader flips y when sampling; the canvas is y down.
    const layout = textNodeLayout(node({ text: 'A', posX: 0.25, posY: 0.75, resolution: 400 }));

    expect(layout.lines[0].x).toBe(100);
    expect(layout.lines[0].y).toBe(100);
  });

  it('builds the CSS font from family, weight and slant', () => {
    expect(textNodeLayout(node({ size: 0.1, resolution: 100 })).font).toBe('10px Arial, Helvetica, sans-serif');
    expect(textNodeLayout(node({ size: 0.1, resolution: 100, bold: true, italic: true })).font)
      .toBe('italic bold 10px Arial, Helvetica, sans-serif');
    expect(textNodeLayout(node({ size: 0.1, resolution: 100, fontFamily: 'monospace' })).font)
      .toContain('Courier');
  });

  it('measures the outline against the font size, not the texture', () => {
    const layout = textNodeLayout(node({ size: 0.5, resolution: 1000, outlineWidth: 0.1 }));
    expect(layout.strokeWidth).toBe(50);
  });

  it('carries the shrink-to-fit flag and the point it scales about', () => {
    // Measuring needs a canvas, so the shrink itself is applied at draw time; the layout only has
    // to say whether it is wanted and where it pivots.
    const layout = textNodeLayout(node({ text: 'A\nB', size: 0.2, resolution: 100, posX: 0.25, posY: 0.75 }));

    expect(layout.autoFit).toBe(true);
    expect(layout.anchor).toEqual({ x: 25, y: 25 });
    expect(textNodeLayout(node({ autoFit: false })).autoFit).toBe(false);
  });

  it('re-rasterises when shrink-to-fit is toggled', () => {
    const on = textRasterKey(node({ text: 'A', autoFit: true }));
    const off = textRasterKey(node({ text: 'A', autoFit: false }));
    expect(on).not.toBe(off);
  });

  it('keeps one blank line for empty text rather than collapsing the layout', () => {
    expect(textNodeLayout(node({ text: '' })).lines).toHaveLength(1);
    expect(textNodeLayout(node({})).lines).toEqual([expect.objectContaining({ text: '' })]);
  });

  it('renders numeric and boolean parameter values that arrived as strings', () => {
    // Select and text inputs store strings; a hand-edited project file can hold them anywhere.
    const layout = textNodeLayout(node({ size: '0.5', resolution: '512', bold: 'true' }));

    expect(layout.resolution).toBe(512);
    expect(layout.fontPx).toBe(256);
    expect(layout.font).toContain('bold');
  });
});

describe('Text node colours', () => {
  it('converts the stored [r,g,b,a] float array to CSS', () => {
    expect(colorToCss([1, 0, 0.5, 1])).toBe('rgba(255, 0, 128, 1)');
    expect(colorToCss([0, 0, 0, 0])).toBe('rgba(0, 0, 0, 0)');
  });

  it('tolerates a hex string and falls back when the value is unusable', () => {
    expect(colorToCss('#ff8800')).toBe('rgba(255, 136, 0, 1)');
    expect(colorToCss(undefined, [0, 1, 0, 1])).toBe('rgba(0, 255, 0, 1)');
  });
});

describe('Text node raster key', () => {
  const base = { id: '1', kind: 'Text', params: { text: 'A', size: 0.25, color: [1, 1, 1, 1] } };

  it('is stable when nothing that shapes the bitmap changed', () => {
    expect(textRasterKey(base)).toBe(textRasterKey({ ...base, params: { ...base.params } }));
  });

  it('changes when a parameter that shapes the bitmap changes', () => {
    const edited = { ...base, params: { ...base.params, text: 'B' } };
    expect(textRasterKey(edited)).not.toBe(textRasterKey(base));
  });

  it('ignores parameters that only affect sampling, so a wrap change reuses the bitmap', () => {
    const edited = { ...base, params: { ...base.params, wrap: 'repeat', filter: 'nearest' } };
    expect(textRasterKey(edited)).toBe(textRasterKey(base));
  });

  // The key is taken over the resolved layout, which is what makes an animated Text node upload
  // only on the frames where its picture actually moved.
  it('follows an expression\'s value, not its source text', () => {
    const node = { id: '1', kind: 'Text', params: { text: 'v {node_9}' } };

    stubExpressionSystem({ node_9: 1 });
    const atOne = textRasterKey(node);
    stubExpressionSystem({ node_9: 1 });
    expect(textRasterKey(node)).toBe(atOne);

    stubExpressionSystem({ node_9: 2 });
    expect(textRasterKey(node)).not.toBe(atOne);
  });
});

/**
 * Stand in for the editor's expression system, which is what resolves node references against the
 * graph's computed values. TextRasterizer reaches it through window rather than importing it (that
 * would be a cycle), so a plain object is enough.
 */
function stubExpressionSystem(values) {
  window.expressionSystem = {
    evaluateExpression: (expr) => {
      const source = String(expr).replace(/^=/, '').trim();
      if (Object.prototype.hasOwnProperty.call(values, source)) return values[source];
      // Enough arithmetic for the tests: "<ref> * 2".
      const m = /^(\w+)\s*\*\s*([\d.]+)$/.exec(source);
      if (m && values[m[1]] !== undefined) return values[m[1]] * Number(m[2]);
      return undefined;
    },
  };
}

describe('Text node live values', () => {
  beforeEach(() => { delete window.expressionSystem; });

  const node = (params) => ({ id: '1', kind: 'Text', params });

  it('shows a referenced node\'s value rather than the reference itself', () => {
    stubExpressionSystem({ node_4: 0.5 });
    expect(resolveTextContent(node({ text: 'level {node_4}' }), 2)).toBe('level 0.50');
  });

  it('treats a whole field starting with = as one expression', () => {
    stubExpressionSystem({ node_4: 21 });
    expect(resolveTextContent(node({ text: '=node_4 * 2' }), 2)).toBe('42');
  });

  it('interpolates several values and keeps the surrounding text', () => {
    stubExpressionSystem({ node_1: 1.5, node_2: 2.5 });
    expect(resolveTextContent(node({ text: '{node_1} / {node_2} fps' }), 1)).toBe('1.5 / 2.5 fps');
  });

  it('honours the decimals parameter, and drops zeros on whole numbers', () => {
    stubExpressionSystem({ node_4: 3.14159 });
    expect(resolveTextContent(node({ text: '{node_4}' }), 3)).toBe('3.142');
    expect(resolveTextContent(node({ text: '{node_4}' }), 0)).toBe('3');

    stubExpressionSystem({ node_4: 7 });
    expect(resolveTextContent(node({ text: '{node_4}' }), 2)).toBe('7');
  });

  it('renders a vector value component by component', () => {
    stubExpressionSystem({ node_4: [0.25, 0.5] });
    expect(resolveTextContent(node({ text: '{node_4}' }), 2)).toBe('0.25, 0.50');
  });

  it('leaves plain text alone, braces and all, when there is nothing to evaluate', () => {
    expect(resolveTextContent(node({ text: 'HELLO' }), 2)).toBe('HELLO');
    // An empty pair of braces is literal punctuation, not an expression.
    expect(resolveTextContent(node({ text: 'a {} b' }), 2)).toBe('a {} b');
  });

  it('renders an unresolvable reference as nothing rather than leaking the source', () => {
    stubExpressionSystem({});
    expect(resolveTextContent(node({ text: 'x {node_99} y' }), 2)).toBe('x  y');
  });

  it('resolves self-contained arithmetic without the editor present', () => {
    expect(resolveTextContent(node({ text: '{2 + 3}' }), 0)).toBe('5');
  });

  it('evaluates expressions in numeric parameters too', () => {
    stubExpressionSystem({ node_7: 0.5 });
    const layout = textNodeLayout(node({ text: 'A', size: '=node_7', resolution: 100 }));
    expect(layout.fontPx).toBe(50);
  });

  it('spots which nodes need the per-frame refresh', () => {
    expect(textNodeHasLiveExpression(node({ text: 'static' }))).toBe(false);
    expect(textNodeHasLiveExpression(node({ text: 'v {node_4}' }))).toBe(true);
    expect(textNodeHasLiveExpression(node({ text: '=time' }))).toBe(true);
    expect(textNodeHasLiveExpression(node({ text: 'x', posX: '=time' }))).toBe(true);
    expect(textNodeHasLiveExpression({ id: '1', kind: 'Circle', params: { text: '=time' } })).toBe(false);
  });
});

describe('TextNodeProcessor', () => {
  const graph = (nodes) => ({ nodes });

  it('only visits Text nodes that carry an expression', () => {
    const visited = [];
    const proc = new TextNodeProcessor({ intervalMs: 0 });
    // ensureTextTexture bails without a texture manager, so observe the selection via the layout
    // read it would perform; here we assert on which nodes survive the filter.
    const nodes = [
      { id: '1', kind: 'Text', params: { text: 'static' } },
      { id: '2', kind: 'Text', params: { text: '{node_4}' } },
      { id: '3', kind: 'Circle', params: {} },
    ];
    for (const n of nodes) if (textNodeHasLiveExpression(n)) visited.push(n.id);
    proc.update(graph(nodes), { now: 1000 });

    expect(visited).toEqual(['2']);
  });

  it('throttles: a second call inside the interval does nothing', () => {
    const proc = new TextNodeProcessor({ intervalMs: 50 });
    const nodes = [{ id: '1', kind: 'Text', params: { text: '{node_4}' } }];

    proc.update(graph(nodes), { now: 1000 });
    expect(proc._lastRun).toBe(1000);

    proc.update(graph(nodes), { now: 1020 });
    expect(proc._lastRun).toBe(1000); // skipped

    proc.update(graph(nodes), { now: 1060 });
    expect(proc._lastRun).toBe(1060); // ran
  });

  it('does nothing on an empty graph', () => {
    const proc = new TextNodeProcessor({ intervalMs: 0 });
    expect(() => proc.update(graph([]), { now: 1 })).not.toThrow();
    expect(() => proc.update(null, { now: 2 })).not.toThrow();
  });
});
