// src/ui/GLSLUtilitiesWindow.js
//
// Tools → Shader Tools → GLSL Utilities (Ctrl/Cmd+Alt+G).
//
// The Custom GLSL node takes WGSL, but the shader code artists arrive with is
// GLSL — a Shadertoy body, a snippet off glslsandbox, a function from an old
// patch. This window is the bridge between the two, and the reference for what
// a node body may say:
//
//   • Convert — paste GLSL, get WGSL shaped for a Custom GLSL node body, with
//     a line-numbered list of everything the translation could not decide by
//     itself. It never silently drops code: anything unconvertible is left in
//     place and called out, because a body that quietly lost a line is worse
//     than one that fails to compile.
//   • Snippets — the handful of bodies worth having ready: polar coordinates,
//     value noise, a cosine palette, SDFs, an audio-reactive ring.
//   • Built-ins — the names a node body can reach for (uv, time, the audio
//     envelopes, the input pins), which are otherwise only discoverable by
//     reading the compiler.
//
// Both halves can write straight into the selected Custom GLSL node, which is
// the point of the window: converting text you then have to paste by hand is
// half a tool.
//
// The translation, the snippet search and the insert-target rule are pure and
// exported, so they are testable without a DOM or a GPU.

import { nodeDisplayName } from '../core/nodeName.js';
import { highlightWGSL } from './ShaderCompilerWindow.js';
import { makeDraggable } from './utils/draggable.js';
import { makeResizable } from './utils/resizable.js';

// ---------------------------------------------------------------------------
// GLSL → WGSL
// ---------------------------------------------------------------------------

/** GLSL type spellings and what they are called in WGSL. */
export const TYPE_MAP = new Map([
  ['bool', 'bool'],
  ['int', 'i32'],
  ['uint', 'u32'],
  ['float', 'f32'],
  ['double', 'f32'],
  ['vec2', 'vec2<f32>'],
  ['vec3', 'vec3<f32>'],
  ['vec4', 'vec4<f32>'],
  ['ivec2', 'vec2<i32>'],
  ['ivec3', 'vec3<i32>'],
  ['ivec4', 'vec4<i32>'],
  ['uvec2', 'vec2<u32>'],
  ['uvec3', 'vec3<u32>'],
  ['uvec4', 'vec4<u32>'],
  ['bvec2', 'vec2<bool>'],
  ['bvec3', 'vec3<bool>'],
  ['bvec4', 'vec4<bool>'],
  ['mat2', 'mat2x2<f32>'],
  ['mat3', 'mat3x3<f32>'],
  ['mat4', 'mat4x4<f32>'],
  ['mat2x2', 'mat2x2<f32>'],
  ['mat2x3', 'mat2x3<f32>'],
  ['mat2x4', 'mat2x4<f32>'],
  ['mat3x2', 'mat3x2<f32>'],
  ['mat3x3', 'mat3x3<f32>'],
  ['mat3x4', 'mat3x4<f32>'],
  ['mat4x2', 'mat4x2<f32>'],
  ['mat4x3', 'mat4x3<f32>'],
  ['mat4x4', 'mat4x4<f32>'],
]);

const TYPE_ALTERNATION = Array.from(TYPE_MAP.keys())
  // Longest first so `mat2x2` is not matched as `mat2` with a stray `x2`.
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Same function, different spelling. */
const FUNCTION_RENAMES = new Map([
  ['inversesqrt', 'inverseSqrt'],
  ['dFdx', 'dpdx'],
  ['dFdy', 'dpdy'],
  ['faceforward', 'faceForward'],
  ['smoothStep', 'smoothstep'],
]);

/** Same value, different name — the uniforms a pasted shader expects. */
const NAME_RENAMES = new Map([
  ['iTime', 'time'],
  ['iGlobalTime', 'time'],
  ['u_time', 'time'],
  ['iChannelTime', 'time'],
]);

/**
 * Names that have no counterpart in a node body. The text is what the artist
 * has to decide; the translation leaves the name alone so the gap is visible
 * in the output rather than papered over.
 */
const UNSUPPORTED_NAMES = new Map([
  ['iResolution', 'There is no resolution uniform in a node body — `uv` is already normalised to 0…1.'],
  ['iMouse', 'No mouse uniform here — wire a Mouse node into an input pin instead.'],
  ['iFrame', 'No frame counter — drive it from `time` instead.'],
  ['gl_FragCoord', 'No fragment coordinate — use `uv` (0…1 across the output).'],
  ['fragCoord', 'Shadertoy\'s fragCoord is in pixels; `uv` is the same idea normalised to 0…1.'],
  ['gl_FragColor', 'A node body has no output variable — its last line IS the value it returns.'],
  ['fragColor', 'A node body has no output variable — its last line IS the value it returns.'],
  ['gl_Position', 'Vertex-stage output; a node body only runs in the fragment stage.'],
  ['texture2D', 'Texture sampling belongs in a texture node — wire it into an input pin.'],
  ['textureLod', 'Texture sampling belongs in a texture node — wire it into an input pin.'],
  ['texelFetch', 'Texture sampling belongs in a texture node — wire it into an input pin.'],
  ['sampler2D', 'Samplers cannot be declared in a node body — wire a texture node into an input pin.'],
  ['samplerCube', 'Samplers cannot be declared in a node body — wire a texture node into an input pin.'],
  ['lessThan', 'WGSL compares vectors with the operators themselves: `a < b` is component-wise.'],
  ['greaterThan', 'WGSL compares vectors with the operators themselves: `a > b` is component-wise.'],
  ['lessThanEqual', 'WGSL compares vectors with the operators themselves: `a <= b` is component-wise.'],
  ['greaterThanEqual', 'WGSL compares vectors with the operators themselves: `a >= b` is component-wise.'],
  ['equal', 'WGSL compares vectors with the operators themselves: `a == b` is component-wise.'],
  ['notEqual', 'WGSL compares vectors with the operators themselves: `a != b` is component-wise.'],
  ['matrixCompMult', 'No component-wise matrix multiply in WGSL — do it column by column.'],
]);

/**
 * The arguments of a call, given the index of its opening parenthesis.
 *
 * @param {string} text
 * @param {number} open - index of '(' in text
 * @returns {{args: string[], end: number}|null} null when the call never closes
 */
function splitCallArgs(text, open) {
  let depth = 0;
  let start = open + 1;
  const args = [];

  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        const tail = text.slice(start, i).trim();
        if (tail || args.length) args.push(tail);
        return { args, end: i };
      }
    } else if (char === ',' && depth === 1) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

/**
 * Rewrite every call to `name`, innermost arguments first.
 *
 * A regex cannot do this: `mod(mod(a, b), c)` needs balanced parentheses to
 * know where the outer call's first argument ends.
 *
 * @param {string} code
 * @param {string} name
 * @param {(args: string[]) => string|null} transform - null leaves the call alone
 * @returns {string}
 */
export function rewriteCalls(code, name, transform) {
  let out = '';
  let i = 0;

  while (i < code.length) {
    const at = code.indexOf(name, i);
    if (at === -1) {
      out += code.slice(i);
      break;
    }

    const after = at + name.length;
    const before = at > 0 ? code[at - 1] : '';
    const opens = /^\s*\(/.exec(code.slice(after));
    // A whole identifier, not a member and not a prefix of a longer name.
    const isCall = opens && !/[\w.]/.test(before) && !/\w/.test(code[after] || '');

    if (!isCall) {
      out += code.slice(i, after);
      i = after;
      continue;
    }

    const call = splitCallArgs(code, after + opens[0].length - 1);
    if (!call) {
      out += code.slice(i, after);
      i = after;
      continue;
    }

    const args = call.args.map((arg) => rewriteCalls(arg, name, transform));
    const replacement = transform(args);
    out += code.slice(i, at);
    out += replacement === null ? code.slice(at, call.end + 1) : replacement;
    i = call.end + 1;
  }

  return out;
}

/** Rewrite whole identifiers, leaving members (`p.time`) and declarations alone. */
function renameIdentifiers(code, renames, onName) {
  return code.replace(/[A-Za-z_]\w*/g, (name, offset) => {
    if (/\.\s*$/.test(code.slice(0, offset))) return name;
    if (onName) onName(name);
    return renames.get(name) ?? name;
  });
}

/** GLSL constructors and casts: `vec2(` → `vec2<f32>(`, `float(` → `f32(`. */
function convertConstructors(code) {
  return code.replace(
    new RegExp(`\\b(${TYPE_ALTERNATION})\\s*\\(`, 'g'),
    (match, type, offset) => (/\.\s*$/.test(code.slice(0, offset)) ? match : `${TYPE_MAP.get(type)}(`),
  );
}

/** `in vec2 p` → `p: vec2<f32>`, for a converted function signature. */
function convertParameter(text) {
  const param = text.trim().replace(/^(?:in|out|inout|const)\s+/, '');
  if (!param) return null;
  const match = new RegExp(`^(${TYPE_ALTERNATION})\\s+([A-Za-z_]\\w*)$`).exec(param);
  if (!match) return null;
  return `${match[2]}: ${TYPE_MAP.get(match[1])}`;
}

/**
 * Split one line into the code to translate and the comment to carry along.
 *
 * GLSL has no string literals, so the first comment opener wins outright.
 * A block comment that closes mid-line leaves the rest of the line untouched
 * — rare enough to report rather than parse, and reporting it is honest.
 *
 * @returns {{code: string, comment: string, inBlock: boolean, tailSkipped: boolean}}
 */
export function splitLineComment(line, inBlock = false) {
  const text = String(line ?? '');

  if (inBlock) {
    const close = text.indexOf('*/');
    if (close === -1) return { code: '', comment: text, inBlock: true, tailSkipped: false };
    const tail = text.slice(close + 2);
    return { code: '', comment: text, inBlock: false, tailSkipped: tail.trim().length > 0 };
  }

  const lineComment = text.indexOf('//');
  const blockComment = text.indexOf('/*');
  const first = [lineComment, blockComment].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return { code: text, comment: '', inBlock: false, tailSkipped: false };

  const code = text.slice(0, first);
  const comment = text.slice(first);
  if (first === lineComment && (blockComment === -1 || lineComment < blockComment)) {
    return { code, comment, inBlock: false, tailSkipped: false };
  }

  const close = comment.indexOf('*/', 2);
  if (close === -1) return { code, comment, inBlock: true, tailSkipped: false };
  return { code, comment, inBlock: false, tailSkipped: comment.slice(close + 2).trim().length > 0 };
}

/**
 * Translate GLSL into the WGSL a Custom GLSL node body speaks.
 *
 * Mechanical things — types, constructors, `mod`, `atan`, the renamed
 * built-ins — are done outright. Anything that needs a decision (a texture
 * lookup, a ternary, a uniform declaration) is left in the output and reported,
 * so the result is always the whole shader plus a list of what to look at.
 *
 * @param {string} source
 * @returns {{ code: string, notes: Array<{line: number, level: 'warn'|'info', text: string}> }}
 */
export function convertGLSL(source) {
  const text = typeof source === 'string' ? source : '';
  if (!text.trim()) return { code: '', notes: [] };

  const notes = [];
  const seen = new Set();
  const out = [];
  let inBlock = false;

  const note = (line, level, message) => {
    // One note per distinct problem per line: a loop body that samples a
    // texture four times has one thing wrong with it, not four.
    const key = `${line}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    notes.push({ line, level, text: message });
  };

  const lines = text.split('\n');

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const split = splitLineComment(raw, inBlock);
    inBlock = split.inBlock;

    if (split.tailSkipped) {
      note(lineNo, 'warn', 'Code after an inline /* … */ comment was left as GLSL — move it to its own line and convert again.');
    }

    let code = split.code;
    const trimmed = code.trim();

    if (!trimmed) {
      out.push(split.comment ? `${code}${split.comment}` : code);
      return;
    }

    // --- lines that do not survive into a node body -----------------------

    if (trimmed.startsWith('#')) {
      const define = /^#define\s+([A-Za-z_]\w*)\s+(.+)$/.exec(trimmed);
      const macro = /^#define\s+([A-Za-z_]\w*)\s*\(/.test(trimmed);
      if (define && !macro) {
        code = `const ${define[1]} = ${define[2].replace(/;$/, '')};`;
        note(lineNo, 'info', `#define ${define[1]} became a const declaration.`);
      } else {
        note(lineNo, 'warn', macro
          ? 'Function-like macros have no WGSL equivalent — write it as a function, or inline it by hand.'
          : `Preprocessor line dropped: WGSL has no ${trimmed.split(/\s+/)[0]}.`);
        out.push(split.comment ? `// ${trimmed}${split.comment}` : `// ${trimmed}`);
        return;
      }
    } else if (/^precision\s+\w+\s+\w+\s*;/.test(trimmed)) {
      note(lineNo, 'info', 'Precision qualifiers dropped — WGSL spells precision in the type (f32, f16).');
      out.push(`// ${trimmed}`);
      return;
    } else if (/^(?:uniform|varying|attribute)\b/.test(trimmed)) {
      note(lineNo, 'warn', 'A node body has no uniforms of its own — wire the value into an input pin and read it as input0, input1, …');
      out.push(`// ${trimmed}`);
      return;
    } else if (/^struct\b/.test(trimmed)) {
      note(lineNo, 'warn', 'WGSL structs declare fields as `name: type,` — this one needs converting by hand.');
    }

    // --- function signatures ---------------------------------------------

    const signature = new RegExp(`^\\s*(void|${TYPE_ALTERNATION})\\s+([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{?\\s*$`).exec(code);
    if (signature) {
      const [, returnType, name, rawParams] = signature;
      const params = rawParams.trim() && rawParams.trim() !== 'void'
        ? rawParams.split(',').map(convertParameter)
        : [];

      if (params.every((param) => param !== null)) {
        const returns = returnType === 'void' ? '' : ` -> ${TYPE_MAP.get(returnType)}`;
        if (/\b(?:out|inout)\s+/.test(rawParams)) {
          note(lineNo, 'warn', 'An out/inout parameter has to become a pointer in WGSL (`ptr<function, T>`), or a returned value.');
        }
        const brace = code.includes('{') ? ' {' : '';
        out.push(`fn ${name}(${params.join(', ')})${returns}${brace}${split.comment}`);
        if (/mainImage/.test(name)) {
          note(lineNo, 'warn', 'mainImage is Shadertoy\'s entry point — a node body wants the contents of this function, not the function itself.');
        } else {
          note(lineNo, 'info', `Converted the signature of ${name}(). A Custom GLSL node body holds statements, not function declarations — keep helpers in a shader you paste elsewhere, or inline this one.`);
        }
        return;
      }
      note(lineNo, 'warn', `The signature of ${name}() has a parameter this could not read — convert it by hand.`);
    }

    // --- declarations ------------------------------------------------------

    // `for (int i = 0; …)` declares its counter inline, ahead of the
    // line-start declaration rule below.
    code = code.replace(new RegExp(`\\bfor\\s*\\(\\s*(?:${TYPE_ALTERNATION})\\s+`, 'g'), 'for (var ');

    const declaration = new RegExp(`^(\\s*)(const\\s+)?(${TYPE_ALTERNATION})\\s+([A-Za-z_]\\w*)\\s*(\\[[^\\]]*\\])?\\s*(=|;)`).exec(code);
    if (declaration) {
      const [, indent, isConst, , name, array, terminator] = declaration;
      if (array) {
        note(lineNo, 'warn', `Array declarations differ in WGSL (\`var ${name}: array<T, N>\`) — convert this one by hand.`);
      } else if (terminator === ';') {
        // Declared now, assigned later: WGSL needs the type on the declaration.
        const type = TYPE_MAP.get(declaration[3]);
        code = `${indent}var ${name}: ${type};`;
      } else {
        // `var` rather than `let`: GLSL locals are mutable, and a translated
        // body that reassigns one would not compile as `let`.
        const keyword = isConst ? 'let' : 'var';
        code = `${indent}${keyword} ${name} ${code.slice(declaration[0].length - 1)}`;
      }
      if (/,/.test(code.split('=')[0] || '')) {
        note(lineNo, 'warn', 'One declaration per statement in WGSL — split this line up.');
      }
    }

    // --- calls and names ---------------------------------------------------

    code = convertConstructors(code);

    // GLSL's mod() is a floored remainder; WGSL's % truncates, so they differ
    // for negative arguments — which is exactly where a pasted shader uses it.
    code = rewriteCalls(code, 'mod', (args) => {
      if (args.length !== 2) return null;
      note(lineNo, 'info', 'mod(a, b) became a floored remainder — WGSL\'s % truncates instead, which differs for negative values.');
      return `((${args[0]}) - (${args[1]}) * floor((${args[0]}) / (${args[1]})))`;
    });

    code = rewriteCalls(code, 'atan', (args) => {
      if (args.length !== 2) return null;
      return `atan2(${args[0]}, ${args[1]})`;
    });

    code = renameIdentifiers(code, new Map([...FUNCTION_RENAMES, ...NAME_RENAMES]), (name) => {
      const problem = UNSUPPORTED_NAMES.get(name);
      if (problem) note(lineNo, 'warn', `${name}: ${problem}`);
      if (name === 'texture' && /\btexture\s*\(/.test(code)) {
        note(lineNo, 'warn', 'texture(): sampling belongs in a texture node — wire it into an input pin.');
      }
    });

    if (code.includes('?') && !/^\s*(case|default)\b/.test(trimmed)) {
      note(lineNo, 'warn', 'WGSL has no ?: — write it as select(whenFalse, whenTrue, condition).');
    }

    out.push(`${code}${split.comment}`);
  });

  return { code: out.join('\n'), notes };
}

/** "3 warnings · 2 notes", for the strip under the toolbar. */
export function noteSummary(notes) {
  const warnings = (notes || []).filter((n) => n.level === 'warn').length;
  const infos = (notes || []).length - warnings;
  if (!warnings && !infos) return { state: 'ok', text: 'Converted — nothing needs a decision' };

  const parts = [];
  if (warnings) parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
  if (infos) parts.push(`${infos} ${infos === 1 ? 'note' : 'notes'}`);
  return { state: warnings ? 'warn' : 'ok', text: `Converted — ${parts.join(' · ')}` };
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

/**
 * Bodies for a Custom GLSL node: statements, then a final expression that is
 * the node's output. No function declarations — the node body has nowhere to
 * put them.
 */
export const SNIPPETS = [
  {
    id: 'polar',
    title: 'Polar coordinates',
    category: 'UV',
    outputType: 'vec2',
    description: 'Radius and angle (in turns) about the centre of the frame.',
    code: [
      'let p = uv * 2.0 - 1.0;',
      'let radius = length(p);',
      'let angle = atan2(p.y, p.x) / (2.0 * pi) + 0.5;',
      'vec2<f32>(radius, angle)',
    ].join('\n'),
  },
  {
    id: 'rotate-uv',
    title: 'Rotate UV about the centre',
    category: 'UV',
    outputType: 'vec2',
    description: 'Spins the coordinate space; wire it into anything that takes a UV.',
    code: [
      'let angle = time * 0.4;',
      'let p = uv - 0.5;',
      'let spun = vec2<f32>(',
      '  p.x * cos(angle) - p.y * sin(angle),',
      '  p.x * sin(angle) + p.y * cos(angle));',
      'spun + 0.5',
    ].join('\n'),
  },
  {
    id: 'kaleidoscope',
    title: 'Kaleidoscope fold',
    category: 'UV',
    outputType: 'vec2',
    description: 'Folds the frame into N mirrored wedges around the centre.',
    code: [
      'let segments = 6.0;',
      'let p = uv - 0.5;',
      'let wedge = 2.0 * pi / segments;',
      'let angle = abs((atan2(p.y, p.x) % wedge) - wedge * 0.5);',
      'vec2<f32>(cos(angle), sin(angle)) * length(p) + 0.5',
    ].join('\n'),
  },
  {
    id: 'hash',
    title: 'White noise (hash)',
    category: 'Noise',
    outputType: 'f32',
    description: 'One random value per cell — the seed of most procedural texture.',
    code: [
      'let cell = floor(uv * 64.0);',
      'fract(sin(dot(cell, vec2<f32>(127.1, 311.7))) * 43758.5453)',
    ].join('\n'),
  },
  {
    id: 'value-noise',
    title: 'Value noise 2D',
    category: 'Noise',
    outputType: 'f32',
    description: 'Smooth noise: four hashed corners, smoothstep-blended.',
    code: [
      'let p = uv * 8.0;',
      'let cell = floor(p);',
      'let f = fract(p);',
      'let w = f * f * (3.0 - 2.0 * f);',
      'let k = vec2<f32>(127.1, 311.7);',
      'let a = fract(sin(dot(cell, k)) * 43758.5453);',
      'let b = fract(sin(dot(cell + vec2<f32>(1.0, 0.0), k)) * 43758.5453);',
      'let c = fract(sin(dot(cell + vec2<f32>(0.0, 1.0), k)) * 43758.5453);',
      'let d = fract(sin(dot(cell + vec2<f32>(1.0, 1.0), k)) * 43758.5453);',
      'mix(mix(a, b, w.x), mix(c, d, w.x), w.y)',
    ].join('\n'),
  },
  {
    id: 'palette',
    title: 'Cosine palette',
    category: 'Color',
    outputType: 'vec3',
    description: 'Inigo Quilez\'s cosine gradient. input0 drives the ramp.',
    code: [
      'let t = fract(input0);',
      'let bias = vec3<f32>(0.5, 0.5, 0.5);',
      'let amp = vec3<f32>(0.5, 0.5, 0.5);',
      'let freq = vec3<f32>(1.0, 1.0, 1.0);',
      'let phase = vec3<f32>(0.0, 0.33, 0.67);',
      'bias + amp * cos(2.0 * pi * (freq * t + phase))',
    ].join('\n'),
  },
  {
    id: 'vignette',
    title: 'Vignette',
    category: 'Color',
    outputType: 'f32',
    description: 'Bright in the middle, falling off towards the corners.',
    code: [
      'let p = (uv - 0.5) * 2.0;',
      '1.0 - smoothstep(0.6, 1.4, length(p))',
    ].join('\n'),
  },
  {
    id: 'scanlines',
    title: 'Drifting scanlines',
    category: 'Color',
    outputType: 'f32',
    description: 'Horizontal bands that crawl slowly up the frame.',
    code: [
      'let lines = 240.0;',
      '0.5 + 0.5 * sin((uv.y + time * 0.05) * lines * pi)',
    ].join('\n'),
  },
  {
    id: 'sdf-circle',
    title: 'Circle SDF',
    category: 'Shapes',
    outputType: 'f32',
    description: 'Signed distance to a circle: negative inside, zero on the edge.',
    code: [
      'let radius = 0.3;',
      'length(uv - 0.5) - radius',
    ].join('\n'),
  },
  {
    id: 'sdf-box',
    title: 'Box SDF',
    category: 'Shapes',
    outputType: 'f32',
    description: 'Signed distance to a rectangle, rounded corners for free.',
    code: [
      'let half = vec2<f32>(0.25, 0.15);',
      'let d = abs(uv - 0.5) - half;',
      'length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0)',
    ].join('\n'),
  },
  {
    id: 'checker',
    title: 'Checkerboard',
    category: 'Shapes',
    outputType: 'f32',
    description: 'Alternating cells — a mask, or a test pattern for a mapping.',
    code: [
      'let cells = 8.0;',
      'let c = floor(uv * cells);',
      'fract((c.x + c.y) * 0.5) * 2.0',
    ].join('\n'),
  },
  {
    id: 'audio-ring',
    title: 'Audio-reactive ring',
    category: 'Audio',
    outputType: 'f32',
    description: 'A ring whose radius rides the bass envelope.',
    code: [
      'let r = length(uv - 0.5);',
      'let ring = 0.15 + 0.3 * audioEnvelopeBass;',
      '1.0 - smoothstep(0.0, 0.04, abs(r - ring))',
    ].join('\n'),
  },
];

/**
 * The snippets matching a query, in library order.
 *
 * Matches title, category, description and body, so "noise" finds the two
 * noise snippets and "atan2" finds the ones that show how to use it.
 */
export function searchSnippets(query, snippets = SNIPPETS) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return snippets.slice();
  const terms = needle.split(/\s+/);
  return snippets.filter((snippet) => {
    const haystack = `${snippet.title} ${snippet.category} ${snippet.description} ${snippet.code}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

// ---------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------

/**
 * What a Custom GLSL node body may say. Mirrors CUSTOM_CODE_BUILTINS in
 * src/codegen/compilers/UtilityNodes.js — the names the compiler substitutes.
 */
export const NODE_BUILTINS = [
  { name: 'uv', type: 'vec2<f32>', what: 'This pixel, 0…1 across the output.' },
  { name: 'time', type: 'f32', what: 'Seconds since the patch started. `u_time` is the same value.' },
  { name: 'input0 … input7', type: 'f32 / vec2 / vec3 / vec4', what: 'The wired input pins, in pin order. The type follows what the code does with them, or the node\'s declared input types.' },
  { name: 'audioEnvelope', type: 'f32', what: 'The overall audio envelope.' },
  { name: 'audioEnvelopeBass', type: 'f32', what: 'Low-band envelope.' },
  { name: 'audioEnvelopeMids', type: 'f32', what: 'Mid-band envelope.' },
  { name: 'audioEnvelopeHighs', type: 'f32', what: 'High-band envelope.' },
  { name: 'audioEnvelopeFull', type: 'f32', what: 'Full-spectrum envelope.' },
  { name: 'pi / PI', type: 'f32', what: '3.14159265359.' },
  { name: 'E', type: 'f32', what: '2.71828182846.' },
];

/** The rules a node body lives by, printed under the built-ins. */
export const BODY_RULES = [
  'The last line is the value the node outputs — no return, no output variable.',
  'Everything above it is ordinary WGSL: `let` for constants, `var` for values you reassign.',
  'Set the node\'s Output Type to match that last line (f32, vec2, vec3, vec4).',
  'WGSL is strict about types: `1` is an i32 and `1.0` an f32, and it will not mix them.',
  'Function declarations have nowhere to live in a body — inline them.',
];

// ---------------------------------------------------------------------------
// Where "Insert" goes
// ---------------------------------------------------------------------------

/**
 * The Custom GLSL node an insert would write into, or why there isn't one.
 *
 * @param {Object|null} editor - window.editor
 * @returns {{node: Object|null, reason: string}}
 */
export function customGLSLTarget(editor) {
  const selected = editor?.selection?.getSelected?.();
  const ids = selected ? Array.from(selected) : [];

  if (ids.length === 0) return { node: null, reason: 'Select a Custom GLSL node to insert into' };
  if (ids.length > 1) return { node: null, reason: 'Select a single Custom GLSL node to insert into' };

  const node = editor?.graph?.nodes?.find((n) => String(n.id) === String(ids[0])) || null;
  if (!node) return { node: null, reason: 'The selected node is no longer in the graph' };
  if (node.kind !== 'CustomGLSL') {
    return { node: null, reason: `${nodeDisplayName(node)} is not a Custom GLSL node` };
  }
  return { node, reason: '' };
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'convert', label: 'Convert' },
  { id: 'snippets', label: 'Snippets' },
  { id: 'builtins', label: 'Built-ins' },
];

const SAMPLE_GLSL = [
  '// Paste GLSL here — a Shadertoy body, a snippet, an old shader.',
  'vec2 p = uv * 2.0 - 1.0;',
  'float r = length(p);',
  'float a = atan(p.y, p.x);',
  'float rings = fract(r * 6.0 - iTime);',
  'mix(0.0, 1.0, smoothstep(0.4, 0.6, rings) * (0.5 + 0.5 * cos(a * 3.0)));',
].join('\n');

export class GLSLUtilitiesWindow {
  constructor() {
    this.panel = null;
    this.visible = false;
    this.tab = 'convert';
    this.converted = { code: '', notes: [] };
    this.snippetId = SNIPPETS[0].id;
    this.query = '';

    this._cleanupDraggable = null;
    this._cleanupResizable = null;
    this._onDocKey = (event) => {
      if (event.key !== 'Escape' || !this.visible) return;
      if (!this.panel?.contains(event.target)) return;
      event.stopPropagation();
      this.hide();
    };
  }

  // --- construction -------------------------------------------------------

  _build() {
    const panel = document.createElement('div');
    panel.id = 'glsl-utilities-window';
    panel.className = 'rz-glu';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'GLSL Utilities');

    panel.innerHTML = `
      <div class="rz-glu-header">
        <h3 class="rz-glu-title">GLSL Utilities</h3>
        <button class="rz-glu-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="rz-glu-tabs" role="tablist">
        ${TABS.map((tab) => `
          <button class="rz-glu-tab" type="button" role="tab" data-tab="${tab.id}">${tab.label}</button>
        `).join('')}
      </div>

      <section class="rz-glu-page" data-page="convert">
        <div class="rz-glu-toolbar">
          <button class="rz-glu-btn rz-glu-primary rz-glu-convert" type="button">Convert to WGSL</button>
          <button class="rz-glu-btn rz-glu-sample" type="button">Sample</button>
          <button class="rz-glu-btn rz-glu-clear" type="button">Clear</button>
          <span class="rz-glu-spacer"></span>
          <button class="rz-glu-btn rz-glu-copy-convert" type="button">Copy WGSL</button>
          <button class="rz-glu-btn rz-glu-insert-convert" type="button">Insert into node</button>
        </div>
        <div class="rz-glu-status"><span class="rz-glu-status-text">Paste GLSL below and press Convert.</span></div>
        <div class="rz-glu-split">
          <div class="rz-glu-pane">
            <div class="rz-glu-pane-title">GLSL in</div>
            <textarea class="rz-glu-input" spellcheck="false" aria-label="GLSL source"
              placeholder="vec2 p = uv * 2.0 - 1.0;&#10;float r = length(p);&#10;..."></textarea>
          </div>
          <div class="rz-glu-pane">
            <div class="rz-glu-pane-title">WGSL out</div>
            <div class="rz-glu-code" tabindex="0" role="group" aria-label="Converted WGSL"></div>
          </div>
        </div>
        <div class="rz-glu-notes rz-glu-quiet"></div>
      </section>

      <section class="rz-glu-page" data-page="snippets" hidden>
        <div class="rz-glu-toolbar">
          <input class="rz-glu-search" type="search" placeholder="Search snippets" aria-label="Search snippets" />
          <span class="rz-glu-spacer"></span>
          <button class="rz-glu-btn rz-glu-copy-snippet" type="button">Copy</button>
          <button class="rz-glu-btn rz-glu-primary rz-glu-insert-snippet" type="button">Insert into node</button>
        </div>
        <div class="rz-glu-split">
          <div class="rz-glu-list" role="listbox" aria-label="Snippets"></div>
          <div class="rz-glu-pane">
            <div class="rz-glu-pane-title rz-glu-snippet-title"></div>
            <div class="rz-glu-code rz-glu-snippet-code" tabindex="0" role="group" aria-label="Snippet source"></div>
          </div>
        </div>
      </section>

      <section class="rz-glu-page rz-glu-reference" data-page="builtins" hidden>
        <div class="rz-glu-reference-body"></div>
      </section>

      <div class="rz-glu-footer"><span class="rz-glu-hint"></span></div>
    `;

    document.body.appendChild(panel);
    this.panel = panel;

    this.inputEl = panel.querySelector('.rz-glu-input');
    this.codeEl = panel.querySelector('.rz-glu-code');
    this.notesEl = panel.querySelector('.rz-glu-notes');
    this.statusEl = panel.querySelector('.rz-glu-status-text');
    this.listEl = panel.querySelector('.rz-glu-list');
    this.snippetTitleEl = panel.querySelector('.rz-glu-snippet-title');
    this.snippetCodeEl = panel.querySelector('.rz-glu-snippet-code');
    this.searchEl = panel.querySelector('.rz-glu-search');
    this.hintEl = panel.querySelector('.rz-glu-hint');

    panel.querySelector('.rz-glu-close').addEventListener('click', () => this.hide());
    panel.querySelector('.rz-glu-convert').addEventListener('click', () => this.convert());
    panel.querySelector('.rz-glu-copy-convert').addEventListener('click', () => this._copy(this.converted.code, 'WGSL'));
    panel.querySelector('.rz-glu-insert-convert').addEventListener('click', () => this.insert(this.converted.code));
    panel.querySelector('.rz-glu-copy-snippet').addEventListener('click', () => this._copy(this._snippet()?.code, 'Snippet'));
    panel.querySelector('.rz-glu-insert-snippet').addEventListener('click', () => this.insert(this._snippet()?.code));

    panel.querySelector('.rz-glu-sample').addEventListener('click', () => {
      this.inputEl.value = SAMPLE_GLSL;
      this.convert();
    });

    panel.querySelector('.rz-glu-clear').addEventListener('click', () => {
      this.inputEl.value = '';
      this.converted = { code: '', notes: [] };
      this._renderConversion();
    });

    for (const tab of panel.querySelectorAll('.rz-glu-tab')) {
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab));
    }

    // Converting as you type would fight the paste: half a pasted shader
    // converts to a list of complaints about the half that hasn't landed yet.
    this.inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.convert();
      }
    });

    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value;
      this._renderSnippets();
    });

    this._renderReference();
    this._renderSnippets();
    this._renderConversion();
    this.showTab(this.tab);

    this._cleanupDraggable = makeDraggable(panel, panel.querySelector('.rz-glu-header'));
    this._cleanupResizable = makeResizable(panel, { minWidth: 520, minHeight: 320 });
  }

  // --- lifecycle ----------------------------------------------------------

  show() {
    if (!this.panel) this._build();
    if (this.visible) return;
    this.visible = true;
    this.panel.classList.add('rz-glu-open');
    document.addEventListener('keydown', this._onDocKey, true);
    this._renderHint();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.panel?.classList.remove('rz-glu-open');
    document.removeEventListener('keydown', this._onDocKey, true);
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible() {
    return this.visible;
  }

  dispose() {
    this.hide();
    if (this._cleanupDraggable) this._cleanupDraggable();
    this._cleanupDraggable = null;
    if (this._cleanupResizable) this._cleanupResizable();
    this._cleanupResizable = null;
    if (this.panel?.parentNode) this.panel.parentNode.removeChild(this.panel);
    this.panel = null;
  }

  showTab(id) {
    if (!this.panel) this._build();
    this.tab = TABS.some((tab) => tab.id === id) ? id : 'convert';
    for (const button of this.panel.querySelectorAll('.rz-glu-tab')) {
      button.classList.toggle('rz-glu-tab-active', button.dataset.tab === this.tab);
      button.setAttribute('aria-selected', String(button.dataset.tab === this.tab));
    }
    for (const page of this.panel.querySelectorAll('.rz-glu-page')) {
      page.hidden = page.dataset.page !== this.tab;
    }
    this._renderHint();
  }

  // --- converting ---------------------------------------------------------

  /**
   * Translate whatever is in the input pane.
   * @returns {{code: string, notes: Array}} the conversion, for tests and callers
   */
  convert() {
    if (!this.panel) this._build();
    this.converted = convertGLSL(this.inputEl.value);
    this._renderConversion();
    return this.converted;
  }

  _renderConversion() {
    const { code, notes } = this.converted;

    if (!code.trim()) {
      const empty = document.createElement('div');
      empty.className = 'rz-glu-empty';
      empty.textContent = this.inputEl?.value.trim()
        ? 'That converted to nothing — every line was a preprocessor or declaration a node body cannot keep.'
        : 'Nothing converted yet.';
      this.codeEl.replaceChildren(empty);
      this.statusEl.textContent = 'Paste GLSL below and press Convert.';
      this.statusEl.dataset.state = 'idle';
      this.notesEl.replaceChildren();
      this.notesEl.classList.add('rz-glu-quiet');
      return;
    }

    this._renderCode(this.codeEl, code);

    const summary = noteSummary(notes);
    this.statusEl.textContent = summary.text;
    this.statusEl.dataset.state = summary.state;

    this.notesEl.replaceChildren();
    this.notesEl.classList.toggle('rz-glu-quiet', notes.length === 0);
    for (const item of notes) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `rz-glu-note rz-glu-${item.level}`;

      const where = document.createElement('span');
      where.className = 'rz-glu-note-loc';
      where.textContent = String(item.line);

      const what = document.createElement('span');
      what.className = 'rz-glu-note-text';
      what.textContent = item.text;

      row.append(where, what);
      row.addEventListener('click', () => this._revealSourceLine(item.line));
      this.notesEl.appendChild(row);
    }
  }

  /** Put the cursor on the line a note is about, in the pane it came from. */
  _revealSourceLine(lineNo) {
    if (!this.inputEl || !lineNo) return;
    const lines = this.inputEl.value.split('\n');
    const start = lines.slice(0, lineNo - 1).reduce((sum, line) => sum + line.length + 1, 0);
    this.inputEl.focus();
    this.inputEl.setSelectionRange(start, start + (lines[lineNo - 1]?.length || 0));
  }

  _renderCode(host, code) {
    const fragment = document.createDocumentFragment();
    highlightWGSL(code).forEach((html, index) => {
      const row = document.createElement('div');
      row.className = 'rz-glu-line';

      const gutter = document.createElement('span');
      gutter.className = 'rz-glu-ln';
      gutter.textContent = String(index + 1);

      const source = document.createElement('code');
      source.className = 'rz-glu-src';
      source.innerHTML = html;

      row.append(gutter, source);
      fragment.appendChild(row);
    });
    host.replaceChildren(fragment);
    host.scrollTop = 0;
  }

  // --- snippets -----------------------------------------------------------

  _snippet() {
    return SNIPPETS.find((snippet) => snippet.id === this.snippetId) || null;
  }

  _renderSnippets() {
    const matches = searchSnippets(this.query);

    // A search that hides the shown snippet moves the selection to the first
    // match, so Copy and Insert always mean what the right-hand pane shows.
    if (matches.length && !matches.some((snippet) => snippet.id === this.snippetId)) {
      this.snippetId = matches[0].id;
    }

    this.listEl.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'rz-glu-empty';
      empty.textContent = `Nothing matches “${this.query}”.`;
      this.listEl.appendChild(empty);
    }

    for (const snippet of matches) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rz-glu-snippet';
      row.dataset.snippet = snippet.id;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(snippet.id === this.snippetId));
      row.classList.toggle('rz-glu-snippet-active', snippet.id === this.snippetId);

      const title = document.createElement('span');
      title.className = 'rz-glu-snippet-name';
      title.textContent = snippet.title;

      const meta = document.createElement('span');
      meta.className = 'rz-glu-snippet-meta';
      meta.textContent = `${snippet.category} · ${snippet.outputType}`;

      const description = document.createElement('span');
      description.className = 'rz-glu-snippet-desc';
      description.textContent = snippet.description;

      row.append(title, meta, description);
      row.addEventListener('click', () => {
        this.snippetId = snippet.id;
        this._renderSnippets();
      });
      this.listEl.appendChild(row);
    }

    const current = this._snippet();
    if (current) {
      this.snippetTitleEl.textContent = `${current.title} — output type ${current.outputType}`;
      this._renderCode(this.snippetCodeEl, current.code);
    } else {
      this.snippetTitleEl.textContent = '';
      this.snippetCodeEl.replaceChildren();
    }
  }

  // --- reference ----------------------------------------------------------

  _renderReference() {
    const host = this.panel.querySelector('.rz-glu-reference-body');
    host.replaceChildren();

    const heading = document.createElement('h4');
    heading.className = 'rz-glu-ref-heading';
    heading.textContent = 'Names a Custom GLSL node body can use';
    host.appendChild(heading);

    const table = document.createElement('div');
    table.className = 'rz-glu-ref-table';
    for (const builtin of NODE_BUILTINS) {
      const name = document.createElement('code');
      name.className = 'rz-glu-ref-name';
      name.textContent = builtin.name;

      const type = document.createElement('code');
      type.className = 'rz-glu-ref-type';
      type.textContent = builtin.type;

      const what = document.createElement('span');
      what.className = 'rz-glu-ref-what';
      what.textContent = builtin.what;

      table.append(name, type, what);
    }
    host.appendChild(table);

    const rules = document.createElement('h4');
    rules.className = 'rz-glu-ref-heading';
    rules.textContent = 'How a body is read';
    host.appendChild(rules);

    const list = document.createElement('ul');
    list.className = 'rz-glu-ref-rules';
    for (const rule of BODY_RULES) {
      const item = document.createElement('li');
      item.textContent = rule;
      list.appendChild(item);
    }
    host.appendChild(list);
  }

  // --- actions ------------------------------------------------------------

  _status(message, type = 'info') {
    if (typeof window.updateStatus === 'function') window.updateStatus(message, type);
    if (this.hintEl) this.hintEl.textContent = message;
  }

  _renderHint() {
    if (!this.hintEl) return;
    const { node, reason } = customGLSLTarget(window.editor);
    this.hintEl.textContent = node ? `Insert writes into ${nodeDisplayName(node)}` : reason;
  }

  async _copy(code, what = 'Code') {
    if (!code) {
      this._status(`No ${what.toLowerCase()} to copy`, 'error');
      return false;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const temp = document.createElement('textarea');
        temp.value = code;
        temp.setAttribute('readonly', '');
        temp.style.position = 'absolute';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      this._status(`${what} copied`);
      return true;
    } catch (error) {
      this._status(`Copy failed: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Write code into the selected Custom GLSL node.
   *
   * Through the parameter panel's value manager when there is one, so the edit
   * lands in undo and the shader rebuilds the same way a typed edit does.
   *
   * @returns {boolean} whether anything was written
   */
  insert(code) {
    if (!code || !code.trim()) {
      this._status('Nothing to insert', 'error');
      return false;
    }

    const editor = window.editor;
    const { node, reason } = customGLSLTarget(editor);
    if (!node) {
      this._status(reason, 'error');
      return false;
    }

    const valueManager = editor?.paramPanel?.valueManager;
    if (valueManager?.setValue) {
      valueManager.setValue(node, 'code', code);
    } else {
      node.params = node.params || {};
      node.params.code = code;
      editor?.onChange?.();
    }

    // The panel is showing the old text in its editor; re-show the node so the
    // artist can see what landed.
    editor?.paramPanel?.showNodeParameters?.(node);
    this._status(`Inserted into ${nodeDisplayName(node)}`);
    return true;
  }
}

/** One window for the session, like the other tool panels. */
let instance = null;

export function getGLSLUtilitiesWindow() {
  if (!instance) instance = new GLSLUtilitiesWindow();
  return instance;
}

export default GLSLUtilitiesWindow;
