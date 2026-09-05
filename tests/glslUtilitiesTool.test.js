// Tools → Shader Tools → GLSL Utilities (src/ui/GLSLUtilitiesWindow.js).
//
// The window is three things and each is pinned down here: the GLSL → WGSL translation (what it
// converts outright, and what it refuses to convert silently), the snippet library, and the rule
// that decides where "Insert into node" writes.
//
// The one end-to-end case drives the real class against a fake editor: convert a pasted shader,
// press insert, and check the node's code parameter changed through the value manager — which is
// what puts the edit in undo and rebuilds the shader.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BODY_RULES,
  GLSLUtilitiesWindow,
  NODE_BUILTINS,
  SNIPPETS,
  convertGLSL,
  customGLSLTarget,
  noteSummary,
  rewriteCalls,
  searchSnippets,
  splitLineComment,
} from '../src/ui/GLSLUtilitiesWindow.js';

/** The lines of converted code, comments and blanks dropped. */
function codeLines(source) {
  return convertGLSL(source).code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'));
}

function noteText(source) {
  return convertGLSL(source).notes.map((note) => note.text).join(' | ');
}

describe('GLSL → WGSL: the mechanical half', () => {
  it('converts declarations to var, and const declarations to let', () => {
    expect(codeLines('float x = 1.0;')).toEqual(['var x = 1.0;']);
    expect(codeLines('const float k = 0.5;')).toEqual(['let k = 0.5;']);
  });

  it('types a declaration that is assigned on a later line', () => {
    expect(codeLines('float total;\ntotal = 1.0;')).toEqual(['var total: f32;', 'total = 1.0;']);
  });

  it('converts constructors and casts, including matrices', () => {
    expect(codeLines('vec3 c = vec3(float(1), 0.0, 0.0);')).toEqual(['var c = vec3<f32>(f32(1), 0.0, 0.0);']);
    expect(codeLines('mat2 m = mat2(1.0, 0.0, 0.0, 1.0);')).toEqual(['var m = mat2x2<f32>(1.0, 0.0, 0.0, 1.0);']);
  });

  it('does not mistake mat2x2 for mat2 with a stray suffix', () => {
    expect(codeLines('mat2x2 m = mat2x2(1.0, 0.0, 0.0, 1.0);')).toEqual(['var m = mat2x2<f32>(1.0, 0.0, 0.0, 1.0);']);
  });

  it('converts a for-loop counter declared inline', () => {
    expect(codeLines('for (int i = 0; i < 4; i++) {')).toEqual(['for (var i = 0; i < 4; i++) {']);
  });

  it('renames the built-ins a pasted shader expects', () => {
    expect(codeLines('float t = iTime * 2.0;')).toEqual(['var t = time * 2.0;']);
    expect(codeLines('float s = inversesqrt(x);')).toEqual(['var s = inverseSqrt(x);']);
  });

  it('leaves a member of the same name alone', () => {
    expect(codeLines('float t = p.iTime;')).toEqual(['var t = p.iTime;']);
  });

  it('turns two-argument atan into atan2', () => {
    expect(codeLines('float a = atan(p.y, p.x);')).toEqual(['var a = atan2(p.y, p.x);']);
  });

  it('leaves one-argument atan as it is', () => {
    expect(codeLines('float a = atan(x);')).toEqual(['var a = atan(x);']);
  });

  it('rewrites mod to a floored remainder, innermost call first', () => {
    expect(codeLines('float m = mod(a, b);')[0])
      .toBe('var m = ((a) - (b) * floor((a) / (b)));');

    // Nested calls: the inner one is rewritten before the outer one wraps it,
    // so no mod survives however deep it was.
    const nested = codeLines('float m = mod(mod(a, b), c);')[0];
    expect(nested).not.toMatch(/\bmod\(/);
    expect(nested).toContain('floor(');
  });

  it('converts a function signature, parameters and return type', () => {
    expect(codeLines('float noise(vec2 p, float scale) {'))
      .toEqual(['fn noise(p: vec2<f32>, scale: f32) -> f32 {']);
    expect(codeLines('void spin(in vec2 p) {')).toEqual(['fn spin(p: vec2<f32>) {']);
  });

  it('turns an object-like #define into a const', () => {
    expect(codeLines('#define TAU 6.283185')).toEqual(['const TAU = 6.283185;']);
  });

  it('keeps comments, and does not convert inside them', () => {
    const { code } = convertGLSL('// float x = 1.0;\nfloat y = 2.0; // and float z');
    expect(code).toContain('// float x = 1.0;');
    expect(code).toContain('var y = 2.0; // and float z');
  });

  it('carries block-comment state across lines', () => {
    const { code } = convertGLSL('/* float a = 1.0;\n   still a comment */\nfloat b = 2.0;');
    // The commented declaration is left as it was; the live one below it converts.
    expect(code).toContain('/* float a = 1.0;');
    expect(code).not.toContain('var a');
    expect(code).toContain('var b = 2.0;');
  });

  it('leaves an empty source alone', () => {
    expect(convertGLSL('')).toEqual({ code: '', notes: [] });
    expect(convertGLSL(null).code).toBe('');
  });
});

describe('GLSL → WGSL: what it refuses to decide', () => {
  it('reports a texture lookup instead of inventing one', () => {
    expect(noteText('vec4 c = texture2D(tex, uv);')).toMatch(/texture node/i);
  });

  it('reports the names a node body does not have', () => {
    expect(noteText('vec2 p = gl_FragCoord.xy / iResolution.xy;')).toMatch(/uv/);
    expect(noteText('gl_FragColor = vec4(1.0);')).toMatch(/last line/i);
  });

  it('reports a ternary, which WGSL spells select()', () => {
    expect(noteText('float x = a > b ? 1.0 : 0.0;')).toMatch(/select\(/);
  });

  it('does not read a switch label as a ternary', () => {
    expect(noteText('case 1:')).not.toMatch(/select\(/);
  });

  it('comments out a uniform and says where the value belongs', () => {
    const { code, notes } = convertGLSL('uniform float speed;');
    expect(code.trim()).toBe('// uniform float speed;');
    expect(notes[0].text).toMatch(/input pin/i);
  });

  it('drops a precision line and a #version, keeping them as comments', () => {
    const { code } = convertGLSL('#version 300 es\nprecision highp float;');
    expect(code.split('\n').every((line) => line.trim().startsWith('//'))).toBe(true);
  });

  it('calls out a function-like macro rather than mangling it', () => {
    expect(noteText('#define SAT(x) clamp(x, 0.0, 1.0)')).toMatch(/macro/i);
  });

  it('names mainImage as Shadertoy\'s entry point', () => {
    expect(noteText('void mainImage(out vec4 fragColor, in vec2 fragCoord) {')).toMatch(/Shadertoy/);
  });

  it('reports each problem on a line once, however often it appears', () => {
    const notes = convertGLSL('vec4 c = texture2D(a, uv) + texture2D(b, uv);').notes;
    expect(notes.filter((note) => /texture node/i.test(note.text))).toHaveLength(1);
  });

  it('points a note at the line it is about', () => {
    const notes = convertGLSL('float a = 1.0;\nuniform float speed;').notes;
    expect(notes[0].line).toBe(2);
  });
});

describe('GLSL → WGSL: the pieces underneath', () => {
  it('splits a line into code and comment', () => {
    expect(splitLineComment('float x = 1.0; // note')).toMatchObject({
      code: 'float x = 1.0; ',
      comment: '// note',
      inBlock: false,
    });
  });

  it('reports code stranded after an inline block comment instead of leaving it as GLSL', () => {
    expect(noteText('/* here */ float x = 1.0;')).toMatch(/inline/i);
  });

  it('leaves a call alone when the transform declines it', () => {
    expect(rewriteCalls('mod(a)', 'mod', (args) => (args.length === 2 ? 'x' : null))).toBe('mod(a)');
  });

  it('leaves an unbalanced call alone rather than swallowing the rest', () => {
    expect(rewriteCalls('mod(a, b', 'mod', () => 'x')).toBe('mod(a, b');
  });

  it('does not match a call whose name is part of a longer identifier', () => {
    expect(rewriteCalls('mymod(a, b)', 'mod', () => 'x')).toBe('mymod(a, b)');
    expect(rewriteCalls('p.mod(a, b)', 'mod', () => 'x')).toBe('p.mod(a, b)');
  });

  it('summarises warnings and notes separately', () => {
    expect(noteSummary([]).state).toBe('ok');
    expect(noteSummary([{ level: 'warn' }, { level: 'info' }])).toMatchObject({ state: 'warn' });
    expect(noteSummary([{ level: 'warn' }, { level: 'info' }]).text).toContain('1 warning · 1 note');
  });
});

describe('snippets', () => {
  it('offers every snippet when nothing is typed', () => {
    expect(searchSnippets('')).toHaveLength(SNIPPETS.length);
    expect(searchSnippets(null)).toHaveLength(SNIPPETS.length);
  });

  it('matches title, category and body', () => {
    expect(searchSnippets('noise').length).toBeGreaterThanOrEqual(2);
    expect(searchSnippets('audio').map((s) => s.id)).toContain('audio-ring');
    expect(searchSnippets('atan2').length).toBeGreaterThan(0);
  });

  it('requires every term to match', () => {
    expect(searchSnippets('noise zzzz')).toHaveLength(0);
  });

  it('ships bodies a node can take: no function declarations, a final expression', () => {
    for (const snippet of SNIPPETS) {
      expect(snippet.code).not.toMatch(/^\s*fn\s/m);
      expect(['f32', 'vec2', 'vec3', 'vec4']).toContain(snippet.outputType);
      const last = snippet.code.trim().split('\n').pop().trim();
      expect(last.endsWith(';')).toBe(false);
    }
  });

  it('documents the built-ins the compiler actually substitutes', () => {
    const names = NODE_BUILTINS.map((entry) => entry.name).join(' ');
    for (const name of ['uv', 'time', 'audioEnvelopeBass', 'input0']) {
      expect(names).toContain(name);
    }
    expect(BODY_RULES.length).toBeGreaterThan(0);
  });
});

describe('where "Insert into node" writes', () => {
  const glslNode = { id: '7', kind: 'CustomGLSL', params: { code: 'input0' } };
  const otherNode = { id: '8', kind: 'Expr', name: 'Ramp' };

  const editorWith = (ids) => ({
    selection: { getSelected: () => new Set(ids) },
    graph: { nodes: [glslNode, otherNode] },
  });

  it('takes the one selected Custom GLSL node', () => {
    expect(customGLSLTarget(editorWith(['7'])).node).toBe(glslNode);
  });

  it('asks for a selection when there is none', () => {
    expect(customGLSLTarget(editorWith([]))).toMatchObject({ node: null });
    expect(customGLSLTarget(editorWith([])).reason).toMatch(/select/i);
  });

  it('refuses a multiple selection', () => {
    expect(customGLSLTarget(editorWith(['7', '8'])).reason).toMatch(/single/i);
  });

  it('says so when the selected node is a different kind', () => {
    expect(customGLSLTarget(editorWith(['8'])).reason).toMatch(/not a Custom GLSL node/);
  });

  it('survives an editor that is not there yet', () => {
    expect(customGLSLTarget(null).node).toBe(null);
    expect(customGLSLTarget({}).node).toBe(null);
  });
});

describe('the window', () => {
  let win;
  let node;

  beforeEach(() => {
    node = { id: '7', kind: 'CustomGLSL', params: { code: 'input0' } };
    const written = [];
    window.editor = {
      selection: { getSelected: () => new Set(['7']) },
      graph: { nodes: [node] },
      paramPanel: {
        valueManager: {
          setValue: (target, name, value) => {
            written.push([name, value]);
            target.params[name] = value;
          },
        },
        showNodeParameters: () => {},
      },
    };
    window.editor.written = written;
    win = new GLSLUtilitiesWindow();
  });

  afterEach(() => {
    win.dispose();
    delete window.editor;
    delete window.updateStatus;
  });

  it('opens, closes and reports which it is', () => {
    expect(win.isVisible()).toBe(false);
    win.show();
    expect(win.isVisible()).toBe(true);
    expect(document.getElementById('glsl-utilities-window')).toBeTruthy();
    win.toggle();
    expect(win.isVisible()).toBe(false);
  });

  it('converts what is in the input pane and prints it with line numbers', () => {
    win.show();
    win.inputEl.value = 'float t = iTime;\nvec2 p = uv * 2.0;';
    const result = win.convert();

    expect(result.code).toContain('var t = time;');
    expect(win.panel.querySelectorAll('.rz-glu-page[data-page="convert"] .rz-glu-line')).toHaveLength(2);
  });

  it('lists a note against the source line, and selects that line when it is clicked', () => {
    win.show();
    win.inputEl.value = 'float a = 1.0;\nuniform float speed;';
    win.convert();

    const notes = win.panel.querySelectorAll('.rz-glu-note');
    expect(notes).toHaveLength(1);
    notes[0].click();
    expect(win.inputEl.selectionStart).toBe('float a = 1.0;\n'.length);
  });

  it('escapes the source instead of letting it become markup', () => {
    win.show();
    win.inputEl.value = 'float x = a < b ? 1.0 : 0.0; // <img src=x onerror=alert(1)>';
    win.convert();

    expect(win.panel.querySelector('.rz-glu-code img')).toBe(null);
    expect(win.panel.querySelector('.rz-glu-code').textContent).toContain('<img');
  });

  it('writes the converted body into the selected node, through the value manager', () => {
    win.show();
    win.inputEl.value = 'float t = iTime;';
    win.convert();

    expect(win.insert(win.converted.code)).toBe(true);
    expect(node.params.code).toContain('var t = time;');
    expect(window.editor.written).toEqual([['code', node.params.code]]);
  });

  it('inserts the snippet the list is showing', () => {
    win.show();
    win.showTab('snippets');
    win.searchEl.value = 'palette';
    win.searchEl.dispatchEvent(new Event('input'));

    expect(win.snippetId).toBe('palette');
    win.panel.querySelector('.rz-glu-insert-snippet').click();
    expect(node.params.code).toContain('cos(2.0 * pi *');
  });

  it('refuses to insert when nothing usable is selected, and says why', () => {
    const said = [];
    window.updateStatus = (message, type) => said.push([message, type]);
    window.editor.selection.getSelected = () => new Set();

    win.show();
    expect(win.insert('let x = 1.0;\nx')).toBe(false);
    expect(said[0][0]).toMatch(/select a custom glsl node/i);
    expect(said[0][1]).toBe('error');
  });

  it('refuses to insert nothing at all', () => {
    win.show();
    expect(win.insert('')).toBe(false);
    expect(node.params.code).toBe('input0');
  });

  it('shows one page at a time', () => {
    win.show();
    win.showTab('builtins');
    const pages = Array.from(win.panel.querySelectorAll('.rz-glu-page'));
    expect(pages.filter((page) => !page.hidden)).toHaveLength(1);
    expect(pages.find((page) => !page.hidden).dataset.page).toBe('builtins');
  });

  it('falls back to the first tab when asked for one that does not exist', () => {
    win.show();
    win.showTab('nonsense');
    expect(win.tab).toBe('convert');
  });
});
