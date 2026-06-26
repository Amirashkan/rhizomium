/**
 * UnifiedExpressionSystem - Single source of truth for expression parsing and evaluation
 *
 * Architecture:
 *   Expression String → Parser → AST → CPU Evaluator / Shader Generator
 *
 * This eliminates the architectural flaw where expressions were interpreted separately
 * by CPU evaluator and shader codegen, causing desyncs for dynamic values.
 */

// ============================================================================
// AST Node Types
// ============================================================================

class ASTNode {
  constructor(type) {
    this.type = type;
  }
}

class NumberLiteral extends ASTNode {
  constructor(value) {
    super('Number');
    this.value = value;
  }
}

class Identifier extends ASTNode {
  constructor(name) {
    super('Identifier');
    this.name = name;
  }
}

class BinaryOp extends ASTNode {
  constructor(operator, left, right) {
    super('BinaryOp');
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

class UnaryOp extends ASTNode {
  constructor(operator, operand) {
    super('UnaryOp');
    this.operator = operator;
    this.operand = operand;
  }
}

class FunctionCall extends ASTNode {
  constructor(name, args) {
    super('FunctionCall');
    this.name = name;
    this.args = args;
  }
}

class ConditionalExpr extends ASTNode {
  constructor(condition, consequent, alternate) {
    super('Conditional');
    this.condition = condition;
    this.consequent = consequent;
    this.alternate = alternate;
  }
}

// ============================================================================
// Tokenizer
// ============================================================================

class Token {
  constructor(type, value, position) {
    this.type = type;
    this.value = value;
    this.position = position;
  }
}

class Tokenizer {
  constructor(input) {
    this.input = input;
    this.position = 0;
    this.tokens = [];
  }

  isDigit(char) {
    return /[0-9]/.test(char);
  }

  isAlpha(char) {
    return /[a-zA-Z_]/.test(char);
  }

  isAlphaNumeric(char) {
    return /[a-zA-Z0-9_]/.test(char);
  }

  peek() {
    return this.input[this.position];
  }

  advance() {
    return this.input[this.position++];
  }

  skipWhitespace() {
    while (this.position < this.input.length && /\s/.test(this.peek())) {
      this.advance();
    }
  }

  readNumber() {
    const start = this.position;
    let hasDecimal = false;

    while (this.position < this.input.length) {
      const char = this.peek();
      if (this.isDigit(char)) {
        this.advance();
      } else if (char === '.' && !hasDecimal) {
        hasDecimal = true;
        this.advance();
      } else {
        break;
      }
    }

    const value = this.input.substring(start, this.position);
    return new Token('NUMBER', parseFloat(value), start);
  }

  readIdentifier() {
    const start = this.position;

    while (this.position < this.input.length && this.isAlphaNumeric(this.peek())) {
      this.advance();
    }

    const value = this.input.substring(start, this.position);
    return new Token('IDENTIFIER', value, start);
  }

  tokenize() {
    while (this.position < this.input.length) {
      this.skipWhitespace();

      if (this.position >= this.input.length) break;

      const char = this.peek();

      // Numbers (including .5 notation)
      if (this.isDigit(char) || (char === '.' && this.isDigit(this.input[this.position + 1]))) {
        this.tokens.push(this.readNumber());
        continue;
      }

      // Identifiers
      if (this.isAlpha(char)) {
        this.tokens.push(this.readIdentifier());
        continue;
      }

      // Operators and punctuation
      const pos = this.position;
      switch (char) {
        case '+':
          this.advance();
          this.tokens.push(new Token('PLUS', '+', pos));
          break;
        case '-':
          this.advance();
          this.tokens.push(new Token('MINUS', '-', pos));
          break;
        case '*':
          this.advance();
          this.tokens.push(new Token('MULTIPLY', '*', pos));
          break;
        case '/':
          this.advance();
          this.tokens.push(new Token('DIVIDE', '/', pos));
          break;
        case '%':
          this.advance();
          this.tokens.push(new Token('MODULO', '%', pos));
          break;
        case '(':
          this.advance();
          this.tokens.push(new Token('LPAREN', '(', pos));
          break;
        case ')':
          this.advance();
          this.tokens.push(new Token('RPAREN', ')', pos));
          break;
        case ',':
          this.advance();
          this.tokens.push(new Token('COMMA', ',', pos));
          break;
        case '?':
          this.advance();
          this.tokens.push(new Token('QUESTION', '?', pos));
          break;
        case ':':
          this.advance();
          this.tokens.push(new Token('COLON', ':', pos));
          break;
        case '<':
          this.advance();
          if (this.peek() === '=') {
            this.advance();
            this.tokens.push(new Token('LTE', '<=', pos));
          } else {
            this.tokens.push(new Token('LT', '<', pos));
          }
          break;
        case '>':
          this.advance();
          if (this.peek() === '=') {
            this.advance();
            this.tokens.push(new Token('GTE', '>=', pos));
          } else {
            this.tokens.push(new Token('GT', '>', pos));
          }
          break;
        case '=':
          this.advance();
          if (this.peek() === '=') {
            this.advance();
            this.tokens.push(new Token('EQ', '==', pos));
          } else {
            throw new Error(`Unexpected character '=' at position ${pos}`);
          }
          break;
        case '!':
          this.advance();
          if (this.peek() === '=') {
            this.advance();
            this.tokens.push(new Token('NEQ', '!=', pos));
          } else {
            this.tokens.push(new Token('NOT', '!', pos));
          }
          break;
        case '&':
          this.advance();
          if (this.peek() === '&') {
            this.advance();
            this.tokens.push(new Token('AND', '&&', pos));
          } else {
            throw new Error(`Unexpected character '&' at position ${pos}`);
          }
          break;
        case '|':
          this.advance();
          if (this.peek() === '|') {
            this.advance();
            this.tokens.push(new Token('OR', '||', pos));
          } else {
            throw new Error(`Unexpected character '|' at position ${pos}`);
          }
          break;
        default:
          throw new Error(`Unexpected character '${char}' at position ${pos}`);
      }
    }

    this.tokens.push(new Token('EOF', null, this.position));
    return this.tokens;
  }
}

// ============================================================================
// Parser - Converts tokens to AST
// ============================================================================

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }

  peek() {
    return this.tokens[this.position];
  }

  advance() {
    return this.tokens[this.position++];
  }

  expect(type) {
    const token = this.advance();
    if (token.type !== type) {
      throw new Error(`Expected ${type} but got ${token.type} at position ${token.position}`);
    }
    return token;
  }

  // Precedence levels (lowest to highest):
  // 1. Ternary conditional (? :)
  // 2. Logical OR (||)
  // 3. Logical AND (&&)
  // 4. Equality (==, !=)
  // 5. Relational (<, >, <=, >=)
  // 6. Additive (+, -)
  // 7. Multiplicative (*, /, %)
  // 8. Unary (-, +, !)
  // 9. Primary (number, identifier, function call, parentheses)

  parse() {
    return this.parseConditional();
  }

  parseConditional() {
    let node = this.parseLogicalOr();

    if (this.peek().type === 'QUESTION') {
      this.advance(); // consume '?'
      const consequent = this.parseConditional();
      this.expect('COLON');
      const alternate = this.parseConditional();
      node = new ConditionalExpr(node, consequent, alternate);
    }

    return node;
  }

  parseLogicalOr() {
    let left = this.parseLogicalAnd();

    while (this.peek().type === 'OR') {
      const operator = this.advance().value;
      const right = this.parseLogicalAnd();
      left = new BinaryOp(operator, left, right);
    }

    return left;
  }

  parseLogicalAnd() {
    let left = this.parseEquality();

    while (this.peek().type === 'AND') {
      const operator = this.advance().value;
      const right = this.parseEquality();
      left = new BinaryOp(operator, left, right);
    }

    return left;
  }

  parseEquality() {
    let left = this.parseRelational();

    while (['EQ', 'NEQ'].includes(this.peek().type)) {
      const operator = this.advance().value;
      const right = this.parseRelational();
      left = new BinaryOp(operator, left, right);
    }

    return left;
  }

  parseRelational() {
    let left = this.parseAdditive();

    while (['LT', 'GT', 'LTE', 'GTE'].includes(this.peek().type)) {
      const operator = this.advance().value;
      const right = this.parseAdditive();
      left = new BinaryOp(operator, left, right);
    }

    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();

    while (['PLUS', 'MINUS'].includes(this.peek().type)) {
      const operator = this.advance().value;
      const right = this.parseMultiplicative();
      left = new BinaryOp(operator, left, right);
    }

    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();

    while (['MULTIPLY', 'DIVIDE', 'MODULO'].includes(this.peek().type)) {
      const operator = this.advance().value;
      const right = this.parseUnary();
      left = new BinaryOp(operator, left, right);
    }

    return left;
  }

  parseUnary() {
    if (['MINUS', 'PLUS', 'NOT'].includes(this.peek().type)) {
      const operator = this.advance().value;
      const operand = this.parseUnary();
      return new UnaryOp(operator, operand);
    }

    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();

    // Number literal
    if (token.type === 'NUMBER') {
      this.advance();
      return new NumberLiteral(token.value);
    }

    // Identifier or function call
    if (token.type === 'IDENTIFIER') {
      const name = this.advance().value;

      // Function call
      if (this.peek().type === 'LPAREN') {
        this.advance(); // consume '('
        const args = [];

        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseConditional());

          while (this.peek().type === 'COMMA') {
            this.advance(); // consume ','
            args.push(this.parseConditional());
          }
        }

        this.expect('RPAREN');
        return new FunctionCall(name, args);
      }

      // Simple identifier
      return new Identifier(name);
    }

    // Parenthesized expression
    if (token.type === 'LPAREN') {
      this.advance(); // consume '('
      const node = this.parseConditional();
      this.expect('RPAREN');
      return node;
    }

    throw new Error(`Unexpected token ${token.type} at position ${token.position}`);
  }
}

// ============================================================================
// CPU Evaluator - Walks AST and evaluates to JavaScript value
// ============================================================================

class CPUEvaluator {
  constructor(context = {}) {
    this.context = context;
    this.builtinFunctions = this.createBuiltinFunctions();
  }

  createBuiltinFunctions() {
    return {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      asin: Math.asin,
      acos: Math.acos,
      atan: Math.atan,
      atan2: Math.atan2,
      sqrt: Math.sqrt,
      abs: Math.abs,
      pow: Math.pow,
      exp: Math.exp,
      log: Math.log,
      log2: Math.log2,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      min: Math.min,
      max: Math.max,
      sign: Math.sign,

      // Custom functions
      clamp: (x, min, max) => Math.max(min, Math.min(max, x)),
      lerp: (a, b, t) => a + (b - a) * t,
      map: (value, inMin, inMax, outMin, outMax) => {
        return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
      },
      smoothstep: (edge0, edge1, x) => {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
      },
      step: (edge, x) => x < edge ? 0 : 1,
      fract: (x) => x - Math.floor(x),
      mod: (x, y) => x - y * Math.floor(x / y),

      // Vector-like functions (operate on arrays or numbers)
      length: (...args) => {
        if (args.length === 1 && Array.isArray(args[0])) {
          return Math.sqrt(args[0].reduce((sum, v) => sum + v * v, 0));
        }
        return Math.sqrt(args.reduce((sum, v) => sum + v * v, 0));
      },
      distance: (a, b) => {
        if (Array.isArray(a) && Array.isArray(b)) {
          return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
        }
        return Math.abs(a - b);
      },
      normalize: (...args) => {
        const len = Math.sqrt(args.reduce((sum, v) => sum + v * v, 0));
        return args.map(v => v / len);
      },
      dot: (a, b) => {
        if (Array.isArray(a) && Array.isArray(b)) {
          return a.reduce((sum, v, i) => sum + v * b[i], 0);
        }
        return a * b;
      },
    };
  }

  evaluate(ast) {
    switch (ast.type) {
      case 'Number':
        return ast.value;

      case 'Identifier':
        if (ast.name in this.context) {
          return this.context[ast.name];
        }
        // Constants
        if (ast.name === 'PI') return Math.PI;
        if (ast.name === 'E') return Math.E;
        throw new Error(`Undefined identifier: ${ast.name}`);

      case 'BinaryOp':
        return this.evaluateBinaryOp(ast);

      case 'UnaryOp':
        return this.evaluateUnaryOp(ast);

      case 'FunctionCall':
        return this.evaluateFunctionCall(ast);

      case 'Conditional':
        return this.evaluateConditional(ast);

      default:
        throw new Error(`Unknown AST node type: ${ast.type}`);
    }
  }

  evaluateBinaryOp(ast) {
    const left = this.evaluate(ast.left);
    const right = this.evaluate(ast.right);

    switch (ast.operator) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return left / right;
      case '%': return left % right;
      case '<': return left < right ? 1 : 0;
      case '>': return left > right ? 1 : 0;
      case '<=': return left <= right ? 1 : 0;
      case '>=': return left >= right ? 1 : 0;
      case '==': return left === right ? 1 : 0;
      case '!=': return left !== right ? 1 : 0;
      case '&&': return (left && right) ? 1 : 0;
      case '||': return (left || right) ? 1 : 0;
      default:
        throw new Error(`Unknown binary operator: ${ast.operator}`);
    }
  }

  evaluateUnaryOp(ast) {
    const operand = this.evaluate(ast.operand);

    switch (ast.operator) {
      case '+': return operand;
      case '-': return -operand;
      case '!': return operand ? 0 : 1;
      default:
        throw new Error(`Unknown unary operator: ${ast.operator}`);
    }
  }

  evaluateFunctionCall(ast) {
    const func = this.builtinFunctions[ast.name];
    if (!func) {
      throw new Error(`Unknown function: ${ast.name}`);
    }

    const args = ast.args.map(arg => this.evaluate(arg));
    return func(...args);
  }

  evaluateConditional(ast) {
    const condition = this.evaluate(ast.condition);
    return condition ? this.evaluate(ast.consequent) : this.evaluate(ast.alternate);
  }
}

// ============================================================================
// Shader Generator - Walks AST and generates WGSL code
// ============================================================================

class ShaderGenerator {
  constructor(variableMapping = {}) {
    // Maps context variables to WGSL equivalents
    // e.g., { time: 'g.time', audioEnvelope: 'g.audioEnvelope' }
    this.variableMapping = {
      time: 'g.time',
      audioEnvelope: 'g.audioEnvelope',
      audioEnvelopeBass: 'g.audioEnvelopeBass',
      audioEnvelopeMids: 'g.audioEnvelopeMids',
      audioEnvelopeHighs: 'g.audioEnvelopeHighs',
      audioEnvelopeFull: 'g.audioEnvelopeFull',
      aspect: 'u.aspect',
      PI: '3.14159265359',
      E: '2.71828182846',
      ...variableMapping
    };

    this.wgslFunctions = this.createWGSLFunctionMapping();
  }

  createWGSLFunctionMapping() {
    // Maps JavaScript function names to WGSL equivalents
    return {
      // Direct mappings (same name)
      sin: 'sin',
      cos: 'cos',
      tan: 'tan',
      asin: 'asin',
      acos: 'acos',
      atan: 'atan',
      atan2: 'atan2',
      sqrt: 'sqrt',
      abs: 'abs',
      pow: 'pow',
      exp: 'exp',
      log: 'log',
      log2: 'log2',
      floor: 'floor',
      ceil: 'ceil',
      round: 'round',
      min: 'min',
      max: 'max',
      sign: 'sign',
      clamp: 'clamp',
      step: 'step',
      length: 'length',
      distance: 'distance',
      normalize: 'normalize',
      dot: 'dot',

      // Custom functions that need special handling
      lerp: 'mix',  // WGSL uses 'mix' instead of 'lerp'
      smoothstep: 'smoothstep',
      fract: 'fract',
      mod: 'mod',

      // Custom functions that need implementation
      map: null,  // Will handle specially
    };
  }

  generate(ast) {
    switch (ast.type) {
      case 'Number':
        return this.generateNumber(ast);

      case 'Identifier':
        return this.generateIdentifier(ast);

      case 'BinaryOp':
        return this.generateBinaryOp(ast);

      case 'UnaryOp':
        return this.generateUnaryOp(ast);

      case 'FunctionCall':
        return this.generateFunctionCall(ast);

      case 'Conditional':
        return this.generateConditional(ast);

      default:
        throw new Error(`Unknown AST node type: ${ast.type}`);
    }
  }

  generateNumber(ast) {
    // Always use .0 suffix for whole numbers to ensure float type in WGSL
    const value = ast.value;
    if (Number.isInteger(value)) {
      return `${value}.0`;
    }
    return value.toString();
  }

  generateIdentifier(ast) {
    const name = ast.name;

    // Check if this identifier has a mapping (time, audioEnvelope*, PI, node_<id>
    // references the caller resolved, etc.)
    if (name in this.variableMapping) {
      return this.variableMapping[name];
    }

    // A `node_<id>` reference is emitted verbatim to reference a shader variable
    // that another node already declared. Callers that don't pre-resolve node
    // references (Noise/Field/Compute params) rely on this passthrough.
    if (/^node_\d/.test(name)) {
      return name;
    }

    // Unknown identifier - almost always a typo (e.g. `tim` for `time`) or an
    // unsupported keyword. Emitting it verbatim would produce invalid WGSL like
    // `sin(tim)`, which fails the ENTIRE shader module and floods the console with
    // WebGPU validation errors. Fail here instead: generateShader() catches this and
    // falls back to a safe `0.0`, so one bad expression only zeroes its own
    // parameter rather than blanking the whole render.
    throw new Error(`Unknown identifier in expression: '${name}'`);
  }

  generateBinaryOp(ast) {
    const left = this.generate(ast.left);
    const right = this.generate(ast.right);

    // WGSL uses the same operators as JavaScript for most cases
    // Comparison operators return bool in WGSL, but we'll handle that contextually
    return `(${left} ${ast.operator} ${right})`;
  }

  generateUnaryOp(ast) {
    const operand = this.generate(ast.operand);
    return `(${ast.operator}${operand})`;
  }

  generateFunctionCall(ast) {
    const funcName = ast.name;
    const args = ast.args.map(arg => this.generate(arg));

    // Special handling for 'map' function
    if (funcName === 'map') {
      if (args.length !== 5) {
        throw new Error('map() requires 5 arguments: value, inMin, inMax, outMin, outMax');
      }
      const [value, inMin, inMax, outMin, outMax] = args;
      return `(${outMin} + (${outMax} - ${outMin}) * ((${value} - ${inMin}) / (${inMax} - ${inMin})))`;
    }

    // Get WGSL function name
    const wgslFunc = this.wgslFunctions[funcName];
    if (wgslFunc === undefined) {
      throw new Error(`Unknown function: ${funcName}`);
    }
    if (wgslFunc === null) {
      throw new Error(`Function ${funcName} requires special handling`);
    }

    return `${wgslFunc}(${args.join(', ')})`;
  }

  generateConditional(ast) {
    const condition = this.generate(ast.condition);
    const consequent = this.generate(ast.consequent);
    const alternate = this.generate(ast.alternate);

    // WGSL uses select(false_value, true_value, condition)
    // But we can also use ternary operator in WGSL
    return `(select(${alternate}, ${consequent}, ${condition}))`;
  }
}

// ============================================================================
// Unified Expression System - Main API
// ============================================================================

export class UnifiedExpressionSystem {
  constructor() {
    this.astCache = new Map();
  }

  /**
   * Check if a value is an expression (starts with '=')
   */
  isExpression(value) {
    return typeof value === 'string' && value.trim().startsWith('=');
  }

  /**
   * Parse expression string into AST
   * Result is cached for performance
   */
  parse(expressionString) {
    // Remove leading '=' if present
    const expr = expressionString.trim().startsWith('=')
      ? expressionString.trim().substring(1)
      : expressionString.trim();

    // Check cache
    if (this.astCache.has(expr)) {
      return this.astCache.get(expr);
    }

    // Tokenize
    const tokenizer = new Tokenizer(expr);
    const tokens = tokenizer.tokenize();

    // Parse
    const parser = new Parser(tokens);
    const ast = parser.parse();

    // Cache and return
    this.astCache.set(expr, ast);
    return ast;
  }

  /**
   * Evaluate expression for CPU (returns JavaScript number)
   */
  evaluateCPU(expressionString, context = {}) {
    try {
      const ast = this.parse(expressionString);
      const evaluator = new CPUEvaluator(context);
      return evaluator.evaluate(ast);
    } catch (error) {


      return 0; // Fallback to 0 on error
    }
  }

  /**
   * Generate WGSL shader code from expression
   *
   * @param {string} expressionString  The expression (with or without leading '=').
   * @param {object} variableMapping   Extra identifier -> WGSL mappings (highest precedence).
   * @param {object} [graph]           Node graph used to resolve `node_<id>` references to
   *                                   clock-driven generators. Defaults to window.editor.graph.
   */
  generateShader(expressionString, variableMapping = {}, graph) {
    try {
      const ast = this.parse(expressionString);
      const resolvedGraph = graph ?? (typeof window !== 'undefined' ? window.editor?.graph : null);
      const nodeRefMapping = this._buildInputNodeReferenceMapping(expressionString, resolvedGraph);
      const generator = new ShaderGenerator({ ...nodeRefMapping, ...variableMapping });
      return generator.generate(ast);
    } catch (error) {


      return '0.0'; // Fallback to 0.0 on error
    }
  }

  /**
   * Map references to global input nodes (Time / RandomTime / Mouse) to their GPU expression so
   * a parameter that *references* such a node reads the live GPU global — exactly like the built-in
   * `time` keyword does. A referenced node is not necessarily wired into the shader, so its
   * `node_<id>` variable may never be declared; emitting an undefined identifier would break shader
   * compilation, and the generator then falls back to `0.0` (the value appears stuck at zero, along
   * with everything downstream). Formulas mirror src/codegen/compilers/InputNodes.js (the wired-node
   * code path): Time -> g.time, RandomTime -> the fract(sin(...)) formula, Mouse -> g.mouse (vec4).
   */
  _buildInputNodeReferenceMapping(expressionString, graph) {
    const mapping = {};
    if (!graph?.nodes?.length) {
      return mapping;
    }

    let identifiers;
    try {
      identifiers = this.extractIdentifiers(expressionString);
    } catch {
      return mapping;
    }
    if (!identifiers.length) {
      return mapping;
    }

    for (const node of graph.nodes) {
      const kind = node?.kind?.toLowerCase();
      if (kind !== 'time' && kind !== 'randomtime' && kind !== 'mouse') {
        continue;
      }

      const base = `node_${node.id}`;
      for (const name of identifiers) {
        // A reference is the base name, optionally with a component suffix (e.g. node_5_x).
        if (name !== base && !name.startsWith(`${base}_`)) {
          continue;
        }
        if (kind === 'time') {
          mapping[name] = 'g.time';
        } else if (kind === 'randomtime') {
          const speed = Number(node.params?.speed);
          const speedLiteral = Number.isFinite(speed) ? this._toFloatLiteral(speed) : '1.0';
          mapping[name] = `fract(sin(g.time * ${speedLiteral} * 12.9898) * 43758.5453)`;
        } else {
          // Mouse is the vec4 global g.mouse (iMouse layout: .xy position, .z held, .w click).
          // Map a component suffix (node_<id>_x / _y / _z / _w, or any xyzw/rgba swizzle) to the
          // matching g.mouse channel; a bare reference resolves to the whole vec4.
          if (name === base) {
            mapping[name] = 'g.mouse';
          } else {
            const suffix = name.slice(base.length + 1);
            mapping[name] = (/^[xyzw]+$/.test(suffix) || /^[rgba]+$/.test(suffix))
              ? `g.mouse.${suffix}`
              : 'g.mouse';
          }
        }
      }
    }
    return mapping;
  }

  _toFloatLiteral(n) {
    return Number.isInteger(n) ? `${n}.0` : `${n}`;
  }

  /**
   * Check if expression depends on time or audio
   * (useful for knowing if it needs to be recomputed every frame)
   */
  isDynamic(expressionString) {
    const expr = expressionString.trim().startsWith('=')
      ? expressionString.trim().substring(1)
      : expressionString.trim();

    return /\b(time|audioEnvelope|audioEnvelopeBass|audioEnvelopeMids|audioEnvelopeHighs|audioEnvelopeFull)\b/.test(expr);
  }

  /**
   * Extract all identifiers used in expression
   * (useful for dependency tracking)
   */
  extractIdentifiers(expressionString) {
    const ast = this.parse(expressionString);
    const identifiers = new Set();

    const walk = (node) => {
      if (node.type === 'Identifier') {
        identifiers.add(node.name);
      } else if (node.type === 'BinaryOp') {
        walk(node.left);
        walk(node.right);
      } else if (node.type === 'UnaryOp') {
        walk(node.operand);
      } else if (node.type === 'FunctionCall') {
        node.args.forEach(walk);
      } else if (node.type === 'Conditional') {
        walk(node.condition);
        walk(node.consequent);
        walk(node.alternate);
      }
    };

    walk(ast);
    return Array.from(identifiers);
  }

  /**
   * Clear the AST cache (useful for testing or memory management)
   */
  clearCache() {
    this.astCache.clear();
  }
}

// Export singleton instance
export const unifiedExpressionSystem = new UnifiedExpressionSystem();
