// A CustomGLSL body with a loop never compiled. The body is split into statements by tracking
// brackets, and every '<' was counted as a template bracket (vec2<f32>), so the comparison in
// `for (var i = 0; i < 4; i++)` opened one that never closed: the loop, and every line after it
// including the body's result, were merged into one, emitted as `node_N = for (...) {...} vec3(...)`.

import { describe, it, expect } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';

function wgslFor(code, outputType = 'vec3') {
  return buildWGSL({
    nodes: [
      { id: '31', kind: 'CustomGLSL', params: { code, outputType }, inputs: [] },
      { id: '99', kind: 'OutputFinal', params: {}, inputs: ['31'] },
    ],
    connections: [],
  }).wgsl;
}

function block(code) {
  const wgsl = wgslFor(code);
  const start = wgsl.indexOf('var node_31');
  return start === -1 ? wgsl : wgsl.slice(start, wgsl.indexOf('finalColor', start));
}

describe('CustomGLSL loops', () => {
  it('keeps a multi-line loop apart from the result line', () => {
    const out = block('var s = 0.0;\nfor (var i = 0; i < 4; i++) {\n  s += f32(i) * 0.1;\n}\nvec3<f32>(uv.x, s, 0.3)');
    expect(out).toContain('for (var i = 0; i < 4; i++) { s += f32(i) * 0.1; }');
    expect(out).toContain('node_31 = vec3<f32>(in.uv.x, s, 0.3);');
    expect(out).not.toMatch(/node_31 = for/);
  });

  it('keeps a one-line loop apart from the result line', () => {
    const out = block('var s = 0.0;\nfor (var i = 0; i < 4; i++) { s += 0.25; }\nreturn vec3<f32>(s);');
    expect(out).toContain('for (var i = 0; i < 4; i++) { s += 0.25; }');
    expect(out).toContain('node_31 = vec3<f32>(s);');
  });

  it('handles > comparisons and nested ifs inside the loop', () => {
    const out = block('var s = 0.0;\nfor (var i = 0; i < 8; i = i + 1) {\n  if (f32(i) > uv.x * 8.0) { s = s + 0.1; }\n}\nvec3<f32>(s)');
    expect(out).toContain('if (f32(i) > in.uv.x * 8.0) { s = s + 0.1; }');
    expect(out).toContain('node_31 = vec3<f32>(s);');
  });

  it('declares a let that the loop writes to as a var', () => {
    const out = block('let s = 0.0;\nfor (var i = 0; i < 4; i++) { s += 0.25; }\nvec3<f32>(s)');
    expect(out).toContain('var s = 0.0;');
    expect(out).not.toMatch(/let s\b|let temp_31_0 = 0\.0/);
    expect(out).toContain('node_31 = vec3<f32>(s);');
  });

  it('still treats a template that spans lines as one expression', () => {
    const wgsl = wgslFor('let c = vec3<\n  f32>(uv.x, 0.0, 1.0);\nc');
    expect(wgsl).toMatch(/let temp_31_0 = vec3< f32>\(in\.uv\.x, 0\.0, 1\.0\);/);
    expect(wgsl).toContain('let node_31 = temp_31_0;');
  });
});
