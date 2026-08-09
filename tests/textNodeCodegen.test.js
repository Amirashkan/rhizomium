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
import { textNodeLayout, textRasterKey, colorToCss } from '../src/core/TextRasterizer.js';

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

  it('binds a 2D texture and sampler under the node id, like an image node', () => {
    const bindings = TextureBindings.generate({
      nodes: [{ id: '10', kind: 'Text' }],
    });

    expect(bindings).toContain('var texture_10: texture_2d<f32>');
    expect(bindings).toContain('var sampler_10: sampler');
  });

  it('samples that binding at the incoming UV, with Y flipped like the other texture nodes', () => {
    const wgsl = buildGraph();

    expect(wgsl).toContain('let srcuv_10 = in.uv;');
    expect(wgsl).toContain('let uv_10 = vec2<f32>(srcuv_10.x, 1.0 - srcuv_10.y);');
    expect(wgsl).toContain('textureSample(texture_10, sampler_10, uv_10)');
  });

  it('reads a connected UV instead of the fragment UV', () => {
    const wgsl = buildGraph({}, { uvInput: '1' });

    expect(wgsl).toContain('let srcuv_10 = node_1;');
  });

  it('zeroes the sample outside the unit square in clamp mode so the edge cannot smear', () => {
    const wgsl = buildGraph({ wrap: 'clamp' });

    expect(wgsl).toContain('let inside_10 = step(0.0, srcuv_10.x) * step(srcuv_10.x, 1.0)');
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

    expect(wgsl).toContain('textureSample(texture_10, sampler_10, sample_uv_20)');
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
});
