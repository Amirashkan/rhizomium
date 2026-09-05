// src/codegen/compilers/wgslExprType.js
//
// Static type inference for the small subset of WGSL a CustomGLSL node body is written in.
//
// Why this exists: a CustomGLSL node reports its output type from the node's `outputType`
// parameter, which defaults to "f32". Nothing checked that against the code the node actually
// emits, so a body like `uv * 2.0` (a vec2) was registered as an f32, and the consumer converted
// it as one — `finalColor = vec3<f32>(node_7);`, which is not a vec3 constructor that exists, so
// the whole fragment shader failed to compile and the output went permanently black.
//
// Inferring the type of the body's final expression lets the compiler register what the node
// really produces. The inference is deliberately conservative: anything it does not fully
// understand yields null, and the caller falls back to the declared type — the previous behaviour.

const VECTOR_TYPES = new Map([
  ['vec2', 'vec2'],
  ['vec3', 'vec3'],
  ['vec4', 'vec4'],
]);

// Functions whose result is a scalar whatever the argument types are.
const SCALAR_RETURNING = new Set(['length', 'distance', 'dot', 'determinant']);

// Functions with a fixed result type.
const FIXED_RETURNING = new Map([
  ['cross', 'vec3'],
  ['textureSample', 'vec4'],
  ['textureSampleLevel', 'vec4'],
  ['textureLoad', 'vec4'],
]);

// Built-ins that are component-wise: the result is the widest argument type, so mix(vec3, vec3,
// f32) is a vec3 and smoothstep(f32, f32, vec2) a vec2. Only these are assumed — a name off this
// list is a helper the shader defines elsewhere, whose return type this module cannot see and must
// not guess at.
const COMPONENT_WISE = new Set([
  'abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'ceil', 'clamp', 'cos', 'cosh',
  'degrees', 'exp', 'exp2', 'faceForward', 'floor', 'fma', 'fract', 'inverseSqrt', 'ldexp', 'log',
  'log2', 'max', 'min', 'mix', 'mod', 'normalize', 'pow', 'quantizeToF16', 'radians', 'reflect',
  'refract', 'round', 'saturate', 'sign', 'sin', 'sinh', 'smoothstep', 'sqrt', 'step', 'tan',
  'tanh', 'trunc',
]);

const RANK = { f32: 1, vec2: 2, vec3: 3, vec4: 4 };

/**
 * Combine two operand types the way a component-wise operation does: a vector operand wins over a
 * scalar, two vectors must agree.
 * @returns {string|null} the combined type, or null if unknown/invalid
 */
function widen(a, b) {
  if (!a || !b) return null;
  if (a === b) return a;
  if (a === 'f32') return b;
  if (b === 'f32') return a;
  return null; // vec2 * vec3 and friends are not valid WGSL anyway
}

const SWIZZLE = /^[xyzwrgba]+$/;

function typeForComponentCount(count) {
  switch (count) {
    case 1: return 'f32';
    case 2: return 'vec2';
    case 3: return 'vec3';
    case 4: return 'vec4';
    default: return null;
  }
}

const NUMBER = /^(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fh]?/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
// Longest first so "<=" is never read as "<".
const PUNCT = ['<=', '>=', '==', '!=', '&&', '||', '<<', '>>', '(', ')', '[', ']', ',', '.', '+', '-', '*', '/', '%', '<', '>', '!', '~', '&', '|', '^', '?', ':', ';', '='];

/**
 * Split a WGSL expression into tokens. Returns null if it meets a character it does not know,
 * which makes the caller give up rather than guess.
 * @param {string} src
 * @returns {Array<{kind: string, text: string}>|null}
 */
function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }

    const rest = src.slice(i);
    let match = NUMBER.exec(rest);
    if (match && /[\d.]/.test(ch)) {
      tokens.push({ kind: 'number', text: match[0] });
      i += match[0].length;
      continue;
    }
    match = IDENT.exec(rest);
    if (match) {
      tokens.push({ kind: 'ident', text: match[0] });
      i += match[0].length;
      continue;
    }
    const punct = PUNCT.find((p) => rest.startsWith(p));
    if (punct) {
      tokens.push({ kind: 'punct', text: punct });
      i += punct.length;
      continue;
    }
    return null; // unknown character — bail out
  }
  return tokens;
}

// Operators that yield a bool rather than a value of the operand type. Their result is not one of
// the types this module speaks, so an expression containing one is reported as unknown.
const BOOLEAN_OPS = new Set(['<', '>', '<=', '>=', '==', '!=', '&&', '||']);
const ARITHMETIC_OPS = new Set(['+', '-', '*', '/', '%']);

class Parser {
  constructor(tokens, env) {
    this.tokens = tokens;
    this.pos = 0;
    this.env = env;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset] || null;
  }

  next() {
    return this.tokens[this.pos++] || null;
  }

  at(text) {
    const token = this.peek();
    return !!token && token.text === text;
  }

  /** expression := unary (op unary)* — precedence is irrelevant, widening is associative. */
  parseExpression() {
    let type = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== 'punct') break;
      if (BOOLEAN_OPS.has(token.text)) return null;
      if (!ARITHMETIC_OPS.has(token.text)) break;
      this.next();
      const right = this.parseUnary();
      type = widen(type, right);
    }
    return type;
  }

  parseUnary() {
    while (this.peek() && this.peek().kind === 'punct' && ['-', '+', '!', '~'].includes(this.peek().text)) {
      if (this.peek().text === '!') return null; // bool
      this.next();
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let type = this.parsePrimary();
    for (;;) {
      if (this.at('.')) {
        this.next();
        const member = this.next();
        if (!member || member.kind !== 'ident') return null;
        if (!SWIZZLE.test(member.text)) {
          // Member access on something that is not a vector (a struct field, `in.uv`). Its type is
          // whatever the environment says about the whole dotted name, resolved in parsePrimary;
          // reaching here means we do not know it.
          return null;
        }
        type = type ? typeForComponentCount(member.text.length) : null;
      } else if (this.at('[')) {
        this.next();
        if (!this.skipBalanced('[', ']')) return null;
        type = type && type !== 'f32' ? 'f32' : null; // vecN[i] is a component
      } else {
        break;
      }
    }
    return type;
  }

  parsePrimary() {
    const token = this.next();
    if (!token) return null;
    if (token.kind === 'number') return 'f32';
    if (token.text === '(') {
      const inner = this.parseExpression();
      if (!this.at(')')) return null;
      this.next();
      return inner;
    }
    if (token.kind !== 'ident') return null;

    let name = token.text;

    // A dotted built-in the substitution pass produced (`in.uv`, `g.time`) is looked up whole,
    // before the swizzle handling in parsePostfix can mistake `.uv` for a component access.
    while (this.at('.') && this.peek(1) && this.peek(1).kind === 'ident' && this.env.has(`${name}.${this.peek(1).text}`)) {
      this.next(); // '.'
      name = `${name}.${this.next().text}`;
    }

    // A generic constructor: vec3<f32>(...). Skip the type arguments.
    if (this.at('<')) {
      const save = this.pos;
      this.next();
      if (this.skipBalanced('<', '>') && this.at('(')) {
        // fall through to the call handling below
      } else {
        this.pos = save;
      }
    }

    if (this.at('(')) {
      this.next();
      const args = this.parseArguments();
      if (args === null) return null;
      return this.typeOfCall(name, args);
    }

    return this.env.has(name) ? this.env.get(name) : null;
  }

  /** Parse a comma-separated argument list, the opening paren already consumed. */
  parseArguments() {
    const args = [];
    if (this.at(')')) { this.next(); return args; }
    for (;;) {
      args.push(this.parseExpression());
      if (this.at(',')) { this.next(); continue; }
      if (this.at(')')) { this.next(); return args; }
      return null;
    }
  }

  typeOfCall(name, args) {
    if (VECTOR_TYPES.has(name)) return VECTOR_TYPES.get(name);
    if (name === 'f32') return 'f32';
    if (SCALAR_RETURNING.has(name)) return 'f32';
    if (FIXED_RETURNING.has(name)) return FIXED_RETURNING.get(name);
    if (!COMPONENT_WISE.has(name)) return null; // an integer cast, a helper the body did not define
    if (args.length === 0) return null;
    // The widest argument wins, and one argument we could not type makes the whole call unknown.
    return args.reduce((acc, arg) => widen(acc, arg), 'f32');
  }

  /** Consume tokens up to the matching close, the opening one already consumed. */
  skipBalanced(open, close) {
    let depth = 1;
    while (depth > 0) {
      const token = this.next();
      if (!token) return false;
      if (token.text === open) depth++;
      else if (token.text === close) depth--;
    }
    return true;
  }
}

/**
 * Infer the WGSL type of a single expression.
 * @param {string} expression
 * @param {Map<string, string|null>} env - identifier -> type for names in scope
 * @returns {'f32'|'vec2'|'vec3'|'vec4'|null} null when the expression is not understood
 */
export function inferExpressionType(expression, env = new Map()) {
  if (typeof expression !== 'string' || !expression.trim()) return null;
  const tokens = tokenize(expression.trim().replace(/;+\s*$/, ''));
  if (!tokens || tokens.length === 0) return null;
  const parser = new Parser(tokens, env);
  const type = parser.parseExpression();
  // Trailing tokens mean the expression was not fully understood (a statement, a stray operator).
  return parser.pos === tokens.length ? type : null;
}

const LET_DECLARATION = /^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]*>)?\s*)?=\s*([\s\S]+)$/;
const VAR_DECLARATION = /^var\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]*>)?\s*)?=\s*([\s\S]+)$/;

/**
 * Infer the type a node body evaluates to: the type of its last line, with the locals declared by
 * the lines before it in scope.
 *
 * @param {string[]} lines - the body's statements, comments already stripped, one expression each
 * @param {Map<string, string|null>} env - identifier -> type for names the body did not declare
 * @returns {'f32'|'vec2'|'vec3'|'vec4'|null} null when the body is not understood
 */
export function inferBodyType(lines, env = new Map()) {
  if (!Array.isArray(lines) || lines.length === 0) return null;

  const scope = new Map(env);
  for (const line of lines.slice(0, -1)) {
    const statement = line.trim().replace(/;+\s*$/, '');
    const declaration = LET_DECLARATION.exec(statement) || VAR_DECLARATION.exec(statement);
    if (!declaration) continue; // a plain statement (for, if, an assignment) declares nothing
    const [, name, annotated, initialiser] = declaration;
    const type = annotated && RANK[annotated] ? annotated : inferExpressionType(initialiser, scope);
    scope.set(name, type);
  }

  return inferExpressionType(lines[lines.length - 1], scope);
}
