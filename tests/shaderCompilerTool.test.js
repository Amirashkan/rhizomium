// Tools → Shader Tools → Shader Compiler (src/ui/ShaderCompilerWindow.js).
//
// The window itself needs a GPU device; everything it decides before and after the driver call does
// not, and that is what is pinned down here: which shaders it offers, what it does with a graph
// that has nothing to compile, how it reads a driver's verdict, and that the highlighter escapes
// the source instead of letting it become markup.
//
// The one end-to-end case (open the window, compile, mark the failing line) drives the real class
// against a fake device — happy-dom has no WebGPU, so the device is the only stand-in needed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FRAGMENT_TARGET_ID,
  ShaderCompilerWindow,
  buildFragmentWGSL,
  compileShader,
  diagnosticSummary,
  highlightWGSL,
  resultSummary,
  shaderTargets,
  sourceForTarget,
  statsLine,
  wgslStats,
} from '../src/ui/ShaderCompilerWindow.js';

/** A GPUDevice stand-in that reports whatever messages the test hands it. */
function fakeDevice(messages = [], { scopedError = null, throwOnCreate = null } = {}) {
  const scopes = [];
  return {
    scopes,
    pushErrorScope: (filter) => scopes.push(filter),
    popErrorScope: async () => {
      scopes.pop();
      return scopedError;
    },
    createShaderModule: () => {
      if (throwOnCreate) throw throwOnCreate;
      return { getCompilationInfo: async () => ({ messages }) };
    },
  };
}

describe('shader compiler: which shaders it offers', () => {
  it('always offers the fragment shader, even with no compute registry', () => {
    const targets = shaderTargets({ nodes: [] }, null);
    expect(targets).toHaveLength(1);
    expect(targets[0].id).toBe(FRAGMENT_TARGET_ID);
  });

  it('lists a compute node alongside the fragment shader, named as the artist named it', () => {
    const registry = new Map([
      ['20', { node: { id: '20', kind: 'ComputeNoise', name: 'Drift' }, wgslCode: '@compute fn main() {}' }],
    ]);

    const targets = shaderTargets({ nodes: [] }, registry);

    expect(targets.map((t) => t.id)).toEqual([FRAGMENT_TARGET_ID, 'compute:20']);
    expect(targets[1].label).toContain('Drift');
  });

  it('tells two identically named compute nodes apart by id', () => {
    const registry = new Map([
      ['20', { node: { id: '20', kind: 'ComputeNoise' }, wgslCode: '@compute fn main() {}' }],
      ['21', { node: { id: '21', kind: 'ComputeNoise' }, wgslCode: '@compute fn main() {}' }],
      ['22', { node: { id: '22', kind: 'ComputeBlur' }, wgslCode: '@compute fn main() {}' }],
    ]);

    const labels = shaderTargets({ nodes: [] }, registry).map((t) => t.label);

    expect(labels.filter((l) => /#20|#21/.test(l))).toHaveLength(2);
    // The one node with a name of its own is not burdened with an id.
    expect(labels.some((l) => /ComputeBlur|Compute Blur/.test(l) && !l.includes('#'))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('skips a registry entry with no shader of its own', () => {
    const registry = new Map([
      ['20', { node: { id: '20', kind: 'ComputeNoise' }, wgslCode: '' }],
      ['21', { wgslCode: '@compute fn main() {}' }],
    ]);

    expect(shaderTargets({ nodes: [] }, registry)).toHaveLength(1);
  });

  it('reads a compute target back out of the registry', () => {
    const registry = new Map([['20', { node: { id: '20', kind: 'ComputeBlur' }, wgslCode: 'BLUR' }]]);
    const target = shaderTargets({ nodes: [] }, registry)[1];

    expect(sourceForTarget(target, { fragment: { code: 'FRAG' }, registry }).code).toBe('BLUR');
    // The fragment target ignores the registry entirely.
    expect(sourceForTarget({ kind: 'fragment' }, { fragment: { code: 'FRAG' }, registry }).code).toBe('FRAG');
  });

  it('says so when the selected compute node has left the graph', () => {
    const target = { id: 'compute:20', kind: 'compute', key: '20', label: 'gone' };
    const result = sourceForTarget(target, { fragment: { code: 'FRAG' }, registry: new Map() });

    expect(result.code).toBe('');
    expect(result.note).toMatch(/no longer in the graph/i);
  });
});

describe('shader compiler: building the fragment shader', () => {
  it('treats an empty canvas as a note, not a failure', () => {
    const result = buildFragmentWGSL({ nodes: [] }, () => {
      throw new Error('should not be called');
    });

    expect(result).toMatchObject({ code: '', failed: false });
    expect(result.note).toMatch(/empty/i);
  });

  it('explains an unwired output rather than showing an empty view', () => {
    const graph = { nodes: [{ id: '1', kind: 'UV' }] };
    const result = buildFragmentWGSL(graph, () => ({ wgsl: '' }));

    expect(result.code).toBe('');
    expect(result.note).toMatch(/OutputFinal/);
    expect(result.failed).toBe(false);
  });

  it('reports a thrown build as a failure, with the reason', () => {
    const graph = { nodes: [{ id: '1', kind: 'UV' }] };
    const result = buildFragmentWGSL(graph, () => {
      throw new Error('cycle in graph');
    });

    expect(result.failed).toBe(true);
    expect(result.note).toContain('cycle in graph');
  });

  it('passes the built WGSL through', () => {
    const graph = { nodes: [{ id: '1', kind: 'UV' }] };
    expect(buildFragmentWGSL(graph, () => ({ wgsl: 'fn main() {}' })).code).toBe('fn main() {}');
  });
});

describe('shader compiler: handing the source to the driver', () => {
  it('reports a clean compile, and leaves no error scope behind', async () => {
    const device = fakeDevice([]);
    const result = await compileShader(device, 'fn main() {}');

    expect(result.status).toBe('ok');
    expect(result.messages).toEqual([]);
    expect(device.scopes).toHaveLength(0);
  });

  it('sorts the driver messages by where they are, not the order they arrived', async () => {
    const device = fakeDevice([
      { type: 'error', message: 'later', lineNum: 40, linePos: 2 },
      { type: 'warning', message: 'earlier', lineNum: 4, linePos: 9 },
    ]);

    const result = await compileShader(device, 'fn main() {}');

    expect(result.status).toBe('error');
    expect(result.messages.map((m) => m.lineNum)).toEqual([4, 40]);
  });

  it('falls back to the error scope when the driver reported nothing else', async () => {
    const device = fakeDevice([], { scopedError: { message: 'device lost' } });
    const result = await compileShader(device, 'fn main() {}');

    expect(result.status).toBe('error');
    expect(result.messages[0].message).toBe('device lost');
  });

  it('does not print the same failure twice when both channels carry it', async () => {
    const device = fakeDevice([{ type: 'error', message: 'unresolved identifier', lineNum: 12, linePos: 3 }], {
      scopedError: { message: 'unresolved identifier' },
    });

    const result = await compileShader(device, 'fn main() {}');

    expect(result.messages).toHaveLength(1);
  });

  it('closes its error scope before awaiting, so the render loop cannot fill it', async () => {
    // The device is shared with the render loop: a scope still open across the
    // getCompilationInfo await collects whatever the current frame complained
    // about, and the window blamed the shader for it.
    const device = fakeDevice([]);
    let scopesWhileWaiting = -1;
    const module = { getCompilationInfo: async () => { scopesWhileWaiting = device.scopes.length; return { messages: [] }; } };
    device.createShaderModule = () => module;

    const result = await compileShader(device, 'fn main() {}');

    expect(scopesWhileWaiting).toBe(0);
    expect(result.status).toBe('ok');
  });

  it('pops the scope it pushed even when createShaderModule throws', async () => {
    const device = fakeDevice([], { throwOnCreate: new Error('module rejected') });
    const result = await compileShader(device, 'fn main() {}');

    expect(result.status).toBe('error');
    expect(result.messages[0].message).toBe('module rejected');
    expect(device.scopes).toHaveLength(0);
  });

  it('distinguishes nothing to compile from nothing to compile it with', async () => {
    expect((await compileShader(fakeDevice(), '   ')).status).toBe('empty');
    expect((await compileShader(null, 'fn main() {}')).status).toBe('unavailable');
  });
});

describe('shader compiler: what it says about a result', () => {
  it('counts by severity', () => {
    const counts = diagnosticSummary([
      { type: 'error' }, { type: 'warning' }, { type: 'info' }, { type: 'error' },
    ]);
    expect(counts).toEqual({ errors: 2, warnings: 1, infos: 1 });
  });

  it('reads a missing device as an idle state, not a failure', () => {
    const summary = resultSummary({ status: 'unavailable', messages: [], durationMs: 0 });
    expect(summary.state).toBe('idle');
    expect(summary.text).toMatch(/no gpu device/i);
  });

  it('names the errors and the time', () => {
    const summary = resultSummary({
      status: 'error',
      messages: [{ type: 'error' }, { type: 'error' }],
      durationMs: 3.21,
    });
    expect(summary.state).toBe('error');
    expect(summary.text).toMatch(/2 errors/);
    expect(summary.text).toMatch(/3\.2 ms/);
  });

  it('calls a compile with warnings compiled, not failed', () => {
    const summary = resultSummary({ status: 'ok', messages: [{ type: 'warning' }], durationMs: 1 });
    expect(summary.state).toBe('warn');
    expect(summary.text).toMatch(/1 warning/);
  });
});

describe('shader compiler: source statistics', () => {
  const source = [
    'struct ParamUniforms {',
    '  _10_scale : f32,',
    '  _10_speed : f32,',
    '};',
    '@group(0) @binding(0) var<uniform> u : U;',
    '@group(0) @binding(1) var<uniform> g : Globals;',
    '@fragment',
    'fn fs_main() -> @location(0) vec4<f32> {',
    '  return vec4<f32>(0.0);',
    '}',
  ].join('\n');

  it('counts the things a shader budget is spent on', () => {
    const stats = wgslStats(source);
    expect(stats).toMatchObject({ lines: 10, bindings: 2, functions: 1, uniforms: 2 });
  });

  it('reports nothing for no source', () => {
    expect(wgslStats('').lines).toBe(0);
    expect(statsLine(wgslStats(''))).toBe('No source');
  });

  it('prints singulars and sizes readably', () => {
    const line = statsLine({ lines: 1, bytes: 512, bindings: 1, functions: 1, uniforms: 0 });
    expect(line).toBe('1 line · 1 binding · 1 function · 512 B');
    expect(statsLine({ lines: 2, bytes: 2048, bindings: 0, functions: 0, uniforms: 0 })).toContain('2.0 KB');
  });
});

describe('shader compiler: highlighting', () => {
  it('escapes the source rather than letting it become markup', () => {
    const [line] = highlightWGSL('var x : vec4<f32> = a < b;');
    expect(line).not.toContain('<f32>');
    expect(line).toContain('&lt;');
  });

  it('marks keywords, types, attributes and numbers', () => {
    const [line] = highlightWGSL('@fragment fn fs_main() -> f32 { return 1.0; }');
    expect(line).toContain('class="rz-sc-attr"');
    expect(line).toContain('class="rz-sc-kw"');
    expect(line).toContain('class="rz-sc-ty"');
    expect(line).toContain('class="rz-sc-num"');
  });

  it('carries a block comment across the lines it spans', () => {
    const lines = highlightWGSL('/* one\ntwo */ let x = 1;');
    expect(lines[0]).toContain('class="rz-sc-comment"');
    expect(lines[1]).toContain('class="rz-sc-comment"');
    // The code after the comment closes is highlighted normally again.
    expect(lines[1]).toContain('class="rz-sc-kw"');
  });

  it('keeps one line per source line', () => {
    expect(highlightWGSL('a\nb\nc')).toHaveLength(3);
  });
});

describe('shader compiler window', () => {
  /** The smallest graph that compiles to a real fragment shader. */
  const wiredGraph = [
    { id: '10', kind: 'UV', params: {}, inputs: [] },
    { id: '99', kind: 'OutputFinal', params: {}, inputs: ['10'] },
  ];

  let panel;
  let previousEditor;
  let previousRenderer;
  let previousRegistry;

  beforeEach(() => {
    previousEditor = window.editor;
    previousRenderer = window.gpuRenderer;
    previousRegistry = window.computeNodeRegistry;
    window.computeNodeRegistry = new Map();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    panel?.dispose();
    panel = null;
    window.editor = previousEditor;
    window.gpuRenderer = previousRenderer;
    window.computeNodeRegistry = previousRegistry;
  });

  it('shows the source and marks the line the driver refused', async () => {
    window.editor = { graph: { nodes: [...wiredGraph], connections: [] } };
    window.gpuRenderer = {
      device: fakeDevice([{ type: 'error', message: 'no matching overload', lineNum: 2, linePos: 5 }]),
    };

    panel = new ShaderCompilerWindow();
    panel.show();
    await panel.compile();

    const node = document.getElementById('shader-compiler-window');
    expect(node).toBeTruthy();
    expect(panel.isVisible()).toBe(true);
    expect(panel.result.status).toBe('error');
    expect(node.querySelector('.rz-sc-badge').dataset.state).toBe('error');
    expect(node.querySelector('.rz-sc-diag-text').textContent).toBe('no matching overload');
    expect(node.querySelector('.rz-sc-line[data-line="2"]').classList.contains('rz-sc-has-error')).toBe(true);
  });

  it('shows the source without compiling when there is no GPU device', async () => {
    window.editor = { graph: { nodes: [...wiredGraph], connections: [] } };
    window.gpuRenderer = null;

    panel = new ShaderCompilerWindow();
    panel.show();
    const result = await panel.compile();

    expect(result.status).toBe('unavailable');
    expect(panel.source.length).toBeGreaterThan(0);
    expect(document.querySelector('.rz-sc-status-text').textContent).toMatch(/no gpu device/i);
  });

  it('explains an empty canvas instead of showing a blank view', async () => {
    window.editor = { graph: { nodes: [], connections: [] } };
    window.gpuRenderer = { device: fakeDevice([]) };

    panel = new ShaderCompilerWindow();
    panel.show();
    await panel.compile();

    expect(document.querySelector('.rz-sc-empty').textContent).toMatch(/empty/i);
    expect(document.querySelector('.rz-sc-badge').dataset.state).toBe('idle');
  });

  it('stops following the graph once it is closed', async () => {
    window.editor = { graph: { nodes: [], connections: [] } };
    window.gpuRenderer = { device: fakeDevice([]) };

    panel = new ShaderCompilerWindow();
    panel.show();
    await panel.compile();

    const compile = vi.spyOn(panel, 'compile');
    panel.hide();
    window.dispatchEvent(new CustomEvent('rz:shader-built'));

    expect(compile).not.toHaveBeenCalled();
    expect(panel.isVisible()).toBe(false);
  });
});
