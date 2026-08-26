// src/codegen/compilers/UtilityNodes.js
import { COLOR_FUNCTIONS_WGSL } from './ColorNodes.js';
import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';
import { compilerParamRefMapping } from '../../utils/paramReferences.js';
import { getInputCount } from '../../data/nodeInputs.js';
import { resolveDiscreteParam } from '../../utils/discreteParams.js';

// The names hand-written (or model-written) node code may use for things that live in the
// generated shader rather than in the snippet itself. Order does not matter: substitution walks
// whole identifiers, so `u_time` is never seen as `time` and `audioEnvelopeBass` is never seen as
// `audioEnvelope`.
const SHADER_BUILTINS = new Map([
  ['u_time', 'g.time'],
  ['time', 'g.time'],
  ['audioEnvelopeBass', 'g.audioEnvelopeBass'],
  ['audioEnvelopeMids', 'g.audioEnvelopeMids'],
  ['audioEnvelopeHighs', 'g.audioEnvelopeHighs'],
  ['audioEnvelopeFull', 'g.audioEnvelopeFull'],
  ['audioEnvelope', 'g.audioEnvelope'],
  ['uv', 'in.uv'],
  ['pi', '3.14159265359'],
  ['PI', '3.14159265359'],
]);

// CustomGLSL bodies also spell Euler's number. Kept out of the Expression node's set so an existing
// patch that uses `E` as a plain name there keeps meaning what it meant.
const CUSTOM_CODE_BUILTINS = new Map([...SHADER_BUILTINS, ['E', '2.71828182846']]);

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;
const LOCAL_DECLARATION = /\b(?:let|var|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Rewrite built-in names in a snippet of node code to what they mean in the generated shader.
 *
 * This used to be a run of `replace(/\buv\b/g, "in.uv")`-style passes, which is wrong three ways
 * and produced WGSL that would not parse:
 *
 *   - A local of the same name was clobbered. `let uv = input0 * 2.0 - 1.0;` — the first line of
 *     nearly every generated node — became `let in.uv = ...`, which is not a declaration at all.
 *   - Member access was clobbered. An input wired to a UV node substitutes as `in.uv`, and the
 *     following pass turned that into `in.in.uv`; `g.time` likewise became `g.g.time`.
 *   - Passes fed each other: `u_time` became `g.time` and then `g.g.time`.
 *
 * So: one pass, over whole identifiers, skipping anything after a dot, and honouring a local
 * declaration from the point it is declared onwards (WGSL does not have the declared name in scope
 * inside its own initialiser, so `let uv = uv * 2.0;` still reads the built-in on the right).
 *
 * @param {string} code
 * @param {Map<string, string>} builtins
 * @returns {string}
 */
export function substituteShaderBuiltins(code, builtins = SHADER_BUILTINS) {
  const shadowedByEarlierLines = new Set();

  return code.split('\n').map((rawLine) => {
    // Comments are stripped further down the pipeline, but rewriting inside one is still noise in
    // anything that logs the intermediate code, so leave it alone.
    const commentAt = rawLine.indexOf('//');
    const body = commentAt >= 0 ? rawLine.slice(0, commentAt) : rawLine;
    const comment = commentAt >= 0 ? rawLine.slice(commentAt) : '';

    // Where each name this line declares comes into scope: past the end of its own statement, so
    // the initialiser still reads the built-in (`let uv = uv * 2.0;` is the outer uv on the right,
    // which is also the only reading WGSL allows).
    const declaredHere = [];
    LOCAL_DECLARATION.lastIndex = 0;
    for (let match; (match = LOCAL_DECLARATION.exec(body)) !== null; ) {
      const statementEnd = body.indexOf(';', match.index + match[0].length);
      declaredHere.push({ name: match[1], from: statementEnd < 0 ? body.length : statementEnd + 1 });
    }

    const rewritten = body.replace(IDENTIFIER, (name, offset) => {
      const replacement = builtins.get(name);
      if (replacement === undefined) return name;

      const before = body.slice(0, offset);
      if (/\.\s*$/.test(before)) return name;                       // `foo.uv` is foo's member
      if (/\b(?:let|var|const)\s+$/.test(before)) return name;      // the name being declared
      if (shadowedByEarlierLines.has(name)) return name;            // a local declared above
      if (declaredHere.some((d) => d.name === name && d.from <= offset)) return name;

      return replacement;
    });

    for (const declaration of declaredHere) shadowedByEarlierLines.add(declaration.name);
    return rewritten + comment;
  }).join('\n');
}

export class UtilityNodes {
  constructor() {
    this.uniformManager = null;
    this.requiresColorHelpers = false;
    // Graph being compiled, used to resolve node references in parameter expressions
    // without relying on the ambient window.editor.graph (absent in the external viewer).
    this.graph = null;
  }

  setUniformManager(manager) {
    this.uniformManager = manager;
  }

  setGraph(graph) {
    this.graph = graph;
  }

  resetHelperTracking() {
    this.requiresColorHelpers = false;
  }

  getHelperFunctions() {
    return this.requiresColorHelpers ? COLOR_FUNCTIONS_WGSL : '';
  }

  /**
   * Get parameter value with default fallback
   */
  getParam(node, name, defaultValue) {
    const raw = node.params?.[name] ?? defaultValue;
    // A `select`/`boolean` control is baked into the generated code, so an expression in one has
    // to resolve to a concrete option before any caller branches on it. Numeric expressions are
    // left as "=..." text for getShaderParam to compile.
    const value = resolveDiscreteParam(node, name, raw, defaultValue);
    if (typeof value === 'boolean') return value;
    return value;
  }

  /**
   * Generate shader expression for parameter (handles =audioEnvelope, =time, etc.)
   *
   * USE UNIFIED AST SYSTEM - This ensures shader code matches CPU evaluation exactly.
   * No more string replacement hacks that cause preview/shader desync!
   */
  getShaderParam(node, name, defaultValue) {
    const value = this.getParam(node, name, defaultValue);
    // An identifier naming another parameter of this node binds to that parameter (see
    // utils/paramReferences.js); without it the shader generator zeroes the whole expression.
    const paramRefs = compilerParamRefMapping(this, node, value, name);

    // Handle expressions with = prefix (like "=audioEnvelope*5")
    if (typeof value === 'string' && value.startsWith('=')) {
      try {
        return unifiedExpressionSystem.generateShader(value, paramRefs, this.graph);
      } catch {

        return String(defaultValue);
      }
    }

    // Handle expressions without = prefix (like "time" or "audioEnvelope*2")
    if (typeof value === 'string' && (/\btime\b/.test(value) || /audioEnvelope/.test(value))) {
      try {
        return unifiedExpressionSystem.generateShader(value, paramRefs, this.graph);
      } catch {

        return String(defaultValue);
      }
    }

    // Return numeric value as string, falling back to the default for
    // malformed/incomplete input (e.g. "." or "" while a field is being typed)
    // so we never emit an unparseable literal into the generated WGSL.
    if (typeof value === 'number') return value.toString();
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue.toString() : parsed.toString();
  }

  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    return [
      'OutputFinal', 'Expr', 'Remap', 'Posterize',
      'ColorToGrayscale', 'ColorInvert', 'ColorSaturate', 
      'ColorContrast', 'ColorBrightness', 'ColorMix',
      'HSVToRGB', 'RGBToHSV', 'Select', 'Compare', 'Switch', 'CustomGLSL'
    ].includes(kind);
  }
  
  /**
   * Compile utility nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @param {Function} getParam - Optional parameter resolver
   * @param {Object} context - Optional context with typeConverter
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput, getParam = null, __context = null) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'OutputFinal':
        return this.compileOutputFinal(node, getInput, nodeId);
      case 'Expr':
        return this.compileExpression(node, getInput, nodeId);
      case 'Remap':
        return this.compileRemap(node, getInput, nodeId);
      case 'Posterize':
        return this.compilePosterize(node, getInput, nodeId);
      case 'ColorToGrayscale':
        return this.compileColorToGrayscale(node, getInput, nodeId);
      case 'ColorInvert':
        return this.compileColorInvert(nodeId, getInput);
      case 'ColorSaturate':
        return this.compileColorSaturate(node, getInput, nodeId);
      case 'ColorContrast':
        return this.compileColorContrast(node, getInput, nodeId);
      case 'ColorBrightness':
        return this.compileColorBrightness(node, getInput, nodeId);
      case 'ColorMix':
        return this.compileColorMix(node, getInput, nodeId);
      case 'HSVToRGB':
        return this.compileHSVToRGB(nodeId, getInput);
      case 'RGBToHSV':
        return this.compileRGBToHSV(nodeId, getInput);
      case 'Select':
        return this.compileSelect(node, getInput, nodeId);
      case 'Compare':
        return this.compileCompare(node, getInput, nodeId);
      case 'Switch':
        return this.compileSwitch(node, getInput, nodeId, getParam);
      case 'CustomGLSL':
        try {
          return this.compileCustomGLSL(node, getInput, nodeId);
        } catch (error) {
          console.error('Error compiling CustomGLSL node:', error);
          // Return a safe fallback
          return {
            line: `let node_${nodeId} = 0.0;`,
            outputType: 'f32'
          };
        }
      default:
        return null;
    }
  }
  
  compileOutputFinal(node, getInput, __nodeId) {
    // Check if the Output node has any input connection


    const color = getInput(0, "vec3", "vec3<f32>(0.0)");

    // Check if connected to a ComputeFieldMapper (3D visualization node)

    return {
      line: `finalColor = ${color};`,
      outputType: "vec3"
    };
  }
  
  compileExpression(node, getInput, nodeId) {
    let expr = (node.expr || "a").toString();

    // One variable per input pin, named after the pin: a, b, c, … The pin list can be grown with
    // the node's "+" chip, so the substitution follows the live count rather than a fixed a/b pair.
    // Substituting longest-name-first is irrelevant here (all names are one char) but the order is
    // still fixed so the emitted code is deterministic.
    const inputCount = Math.max(1, getInputCount(node));
    for (let i = 0; i < inputCount; i++) {
      const name = String.fromCharCode(97 + i); // 'a', 'b', 'c', …
      const value = getInput(i, "f32", "0.0");
      expr = expr.replace(new RegExp(`\\b${name}\\b`, 'g'), `(${value})`);
    }

    expr = substituteShaderBuiltins(expr);

    let line = `let node_${nodeId} = ${expr};`;

    // GUARD: like CustomGLSL, the Expression node recompiles while the user is
    // still typing, so a half-finished expression ("a +" -> `(0.0) +;`, "sin(a"
    // -> `sin((0.0);`) would emit invalid WGSL and spam the console with
    // shader-compile errors on every keystroke. Fall back to a harmless default
    // until the expression parses again. See isIncompleteWGSLExpression.
    if (this.isIncompleteWGSLExpression(line)) {
      line = `let node_${nodeId} = 0.0;`;
    }

    return {
      line,
      outputType: "f32"
    };
  }
  
  compileRemap(node, getInput, nodeId) {
    const value = getInput(0, "f32", "0.0");
    const inMin = this.getShaderParam(node, 'inMin', 0.0);
    const inMax = this.getShaderParam(node, 'inMax', 1.0);
    const outMin = this.getShaderParam(node, 'outMin', 0.0);
    const outMax = this.getShaderParam(node, 'outMax', 1.0);
    const doClamp = this.getParam(node, 'clamp', false);

    const remapped = `(((${value}) - ${inMin}) / max(${inMax} - ${inMin}, 0.0001)) * (${outMax} - ${outMin}) + ${outMin}`;
    const final = doClamp ? `clamp(${remapped}, min(${outMin}, ${outMax}), max(${outMin}, ${outMax}))` : remapped;

    return {
      line: `let node_${nodeId} = ${final};`,
      outputType: "f32"
    };
  }
  
  compilePosterize(node, getInput, nodeId) {
    const value = getInput(0, "f32", "0.0");
    const steps = node.params?.steps ?? 8.0;
    
    return {
      line: `let node_${nodeId} = floor(${value} * ${steps}) / ${steps};`,
      outputType: "f32"
    };
  }
  
  compileColorToGrayscale(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    const method = node.params?.method || "luminance";
    
    let formula;
    switch (method) {
      case "luminance":
        formula = `dot(${color}, vec3<f32>(0.299, 0.587, 0.114))`;
        break;
      case "average":
        formula = `(${color}.x + ${color}.y + ${color}.z) / 3.0`;
        break;
      case "lightness":
        formula = `(max(max(${color}.x, ${color}.y), ${color}.z) + min(min(${color}.x, ${color}.y), ${color}.z)) / 2.0`;
        break;
      default:
        formula = `dot(${color}, vec3<f32>(0.299, 0.587, 0.114))`;
    }
    
    return {
      line: `let node_${nodeId} = ${formula};`,
      outputType: "f32"
    };
  }
  
  compileColorInvert(nodeId, getInput) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    return {
      line: `let node_${nodeId} = vec3<f32>(1.0) - (${color});`,
      outputType: "vec3"
    };
  }
  
  compileColorSaturate(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    const saturation = node.params?.saturation ?? 1.0;
    
    return {
      line: `
  let gray_${nodeId} = dot(${color}, vec3<f32>(0.299, 0.587, 0.114));
  let node_${nodeId} = mix(vec3<f32>(gray_${nodeId}), ${color}, ${saturation});`,
      outputType: "vec3"
    };
  }
  
  compileColorContrast(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.5)");
    const contrast = node.params?.contrast ?? 1.0;
    const pivot = node.params?.pivot ?? 0.5;
    
    return {
      line: `let node_${nodeId} = ((${color}) - ${pivot}) * ${contrast} + ${pivot};`,
      outputType: "vec3"
    };
  }
  
  compileColorBrightness(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    const brightness = this.getShaderParam(node, 'brightness', 0.0);

    return {
      line: `let node_${nodeId} = (${color}) + vec3<f32>(${brightness});`,
      outputType: "vec3"
    };
  }
  
  compileColorMix(node, getInput, nodeId) {
    const base = getInput(0, "vec3", "vec3<f32>(0.0)");
    const blend = getInput(1, "vec3", "vec3<f32>(0.0)");
    const factor = getInput(2, "f32", "0.5");
    const modeRaw = node.params?.mode ?? node.props?.mode ?? "mix";
    const normalizedMode = (() => {
      const formatted = modeRaw.toString().trim().toLowerCase();
      return formatted.length > 0 ? formatted : "mix";
    })();
    const factorExpr = `clamp(${factor}, 0.0, 1.0)`;
    
    let blendedExpr;
    switch (normalizedMode) {
      case "mix":
        blendedExpr = blend;
        break;
      case "multiply":
        this.requiresColorHelpers = true;
        blendedExpr = `blendMultiply(${base}, ${blend})`;
        break;
      case "screen":
        this.requiresColorHelpers = true;
        blendedExpr = `blendScreen(${base}, ${blend})`;
        break;
      case "overlay":
        this.requiresColorHelpers = true;
        blendedExpr = `blendOverlay(${base}, ${blend})`;
        break;
      case "add":
        this.requiresColorHelpers = true;
        blendedExpr = `blendAdd(${base}, ${blend})`;
        break;
      case "subtract":
        this.requiresColorHelpers = true;
        blendedExpr = `blendSubtract(${base}, ${blend})`;
        break;
      case "divide":
        this.requiresColorHelpers = true;
        blendedExpr = `blendDivide(${base}, ${blend})`;
        break;
      case "difference":
        this.requiresColorHelpers = true;
        blendedExpr = `blendDifference(${base}, ${blend})`;
        break;
      case "darken":
        this.requiresColorHelpers = true;
        blendedExpr = `blendDarken(${base}, ${blend})`;
        break;
      case "lighten":
        this.requiresColorHelpers = true;
        blendedExpr = `blendLighten(${base}, ${blend})`;
        break;
      default:
        blendedExpr = blend;
        break;
    }
    
    return {
      line: `
  let factor_${nodeId} = ${factorExpr};
  let blended_${nodeId} = ${blendedExpr};
  let node_${nodeId} = mix(${base}, blended_${nodeId}, factor_${nodeId});`,
      outputType: "vec3"
    };
  }
  
  compileHSVToRGB(nodeId, getInput) {
    const hsv = getInput(0, "vec3", "vec3<f32>(0.0, 0.0, 1.0)");
    return {
      line: `let node_${nodeId} = hsvToRgb(${hsv});`,
      outputType: "vec3"
    };
  }
  
  compileRGBToHSV(nodeId, getInput) {
    const rgb = getInput(0, "vec3", "vec3<f32>(1.0)");
    return {
      line: `let node_${nodeId} = rgbToHsv(${rgb});`,
      outputType: "vec3"
    };
  }
  
  compileSelect(node, getInput, nodeId) {
    const a = getInput(0, "vec3", "vec3<f32>(0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(1.0)");
    const condition = getInput(2, "f32", "0.5");
    const threshold = node.params?.threshold ?? 0.5;
    
    return {
      line: `let node_${nodeId} = select(${a}, ${b}, ${condition} > ${threshold});`,
      outputType: "vec3"
    };
  }
  
  compileCompare(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    const operator = node.params?.operator || "greater";
    const epsilon = node.params?.epsilon ?? 0.001;
    
    let comparison;
    switch (operator) {
      case "equal":
        comparison = `abs(${a} - ${b}) < ${epsilon}`;
        break;
      case "notEqual":
        comparison = `abs(${a} - ${b}) >= ${epsilon}`;
        break;
      case "greater":
        comparison = `${a} > ${b}`;
        break;
      case "greaterEqual":
        comparison = `${a} >= ${b}`;
        break;
      case "less":
        comparison = `${a} < ${b}`;
        break;
      case "lessEqual":
        comparison = `${a} <= ${b}`;
        break;
      default:
        comparison = `${a} > ${b}`;
    }
    
    return {
      line: `let node_${nodeId} = select(0.0, 1.0, ${comparison});`,
      outputType: "f32"
    };
  }

  compileSwitch(node, getInput, nodeId, getParam = null) {
    // Helper to get output type from node definition
    const getNodeOutputType = (inputId) => {
      if (!inputId || !window.editor?.graph?.nodes) return null;
      const sourceNode = window.editor.graph.nodes.find(n => n.id === inputId);
      if (!sourceNode || !window.NodeDefs) return null;
      const nodeDef = window.NodeDefs[sourceNode.kind];
      if (!nodeDef || !nodeDef.pinsOut || nodeDef.pinsOut.length === 0) return null;
      return nodeDef.pinsOut[0].type || null;
    };

    // DYNAMIC SELECT: when `select` is an expression/node-reference (e.g. "=node_5"
    // or "=sin(time)"), the chosen branch is only known at runtime. The compile-time
    // single-branch optimization below can't represent that, so a referenced select
    // used to floor to NaN and emit a black vec3(0.0). Detect that case and compile a
    // runtime selection across all four inputs instead.
    const rawSelect = node.params?.select;
    const isDynamicSelect =
      typeof rawSelect === 'string' && rawSelect.trim().startsWith('=') && typeof getParam === 'function';

    if (isDynamicSelect) {
      return this.compileSwitchDynamic(node, getInput, nodeId, getParam, getNodeOutputType);
    }

    // Static select (constant): only evaluate the selected input to avoid compiling
    // unused node graphs. This significantly improves performance when switching
    // between complex inputs. The range follows the node's live pin count, which the
    // "+" chip can grow past the four pins the definition names.
    const inputCount = Math.max(1, getInputCount(node));
    const selectParam = Math.max(0, Math.min(inputCount - 1, Math.floor(Number(rawSelect) || 0)));

    // Only get the selected input - unselected inputs won't be evaluated
    const selectedIndex = selectParam;
    const selectedInput = getInput(selectedIndex, null, "vec3<f32>(0.0)");
    
    // Extract code and type from selected input
    const getCode = (input) => {
      if (typeof input === 'object' && input !== null && input.code !== undefined) {
        return input.code;
      }
      return input || "vec3<f32>(0.0)";
    };
    
    const getType = (input, index) => {
      // First try to get type from the input object
      if (typeof input === 'object' && input !== null && input.type !== undefined) {
        // If type is f32 but we have a connected input, try to get actual type from node definition
        if (input.type === "f32" && node.inputs?.[index]) {
          const actualType = getNodeOutputType(node.inputs[index]);
          if (actualType && actualType !== "f32") {
            return actualType;
          }
        }
        return input.type;
      }
      // For string inputs, try to infer type from the value
      if (typeof input === 'string') {
        if (input.includes('vec3')) return "vec3";
        if (input.includes('vec2')) return "vec2";
        if (input.includes('vec4')) return "vec4";
      }
      // If we have a connected input, try to get type from node definition
      if (node.inputs?.[index]) {
        const actualType = getNodeOutputType(node.inputs[index]);
        if (actualType) return actualType;
      }
      return "vec3"; // Default to vec3 for colors
    };
    
    const code = getCode(selectedInput);
    const outputType = getType(selectedInput, selectedIndex);
    
    // Output only the selected input (unselected inputs are not evaluated!)
    return {
      line: `let node_${nodeId} = ${code};`,
      outputType: outputType || "vec3"
    };
  }

  // Runtime selection for a dynamic `select` (driven by a node reference or expression).
  // Every input is compiled and the active branch is chosen each frame, so a
  // referenced Float (fixed or animated, e.g. sin(time)) actually drives the switch
  // instead of compiling to a black vec3(0.0).
  compileSwitchDynamic(node, getInput, nodeId, getParam, getNodeOutputType) {
    const typeRank = { f32: 0, vec2: 1, vec3: 2, vec4: 3 };
    const rankType = ['f32', 'vec2', 'vec3', 'vec4'];
    const defaultForType = {
      f32: '0.0',
      vec2: 'vec2<f32>(0.0)',
      vec3: 'vec3<f32>(0.0)',
      vec4: 'vec4<f32>(0.0)',
    };

    // First pass: discover the type of each connected input (type-aware mode).
    const inputTypeOf = (index) => {
      const probe = getInput(index, null, defaultForType.vec3);
      let type = (probe && typeof probe === 'object' && probe.type) ? probe.type : null;
      // f32 from a connected node can be a stale default - prefer the node definition.
      if ((!type || type === 'f32') && node.inputs?.[index]) {
        const actual = getNodeOutputType(node.inputs[index]);
        if (actual) type = actual;
      }
      // Only count connected inputs toward the common type.
      return node.inputs?.[index] ? (type || 'vec3') : null;
    };

    const inputCount = Math.max(1, getInputCount(node));

    let commonRank = -1;
    for (let i = 0; i < inputCount; i++) {
      const t = inputTypeOf(i);
      if (t && typeRank[t] !== undefined) {
        commonRank = Math.max(commonRank, typeRank[t]);
      }
    }
    const commonType = commonRank >= 0 ? rankType[commonRank] : 'vec3';

    // Second pass: fetch each input converted to the common type (string mode).
    const branch = (i) => getInput(i, commonType, defaultForType[commonType]);
    const sel = `sel_${nodeId}`;

    // Resolve the select expression to a runtime scalar and clamp it to a valid index.
    const selectExpr = getParam('select', '0');

    // Nested select() picks input 0 for index 0 (or out of range), input i otherwise. Built by
    // folding so it covers however many pins the node currently has.
    let chooser = branch(0);
    for (let i = 1; i < inputCount; i++) {
      chooser = `select(${chooser}, ${branch(i)}, ${sel} == ${i})`;
    }

    return {
      line:
        `let ${sel} = i32(round(f32(${selectExpr})));\n` +
        `  let node_${nodeId} = ${chooser};`,
      outputType: commonType,
    };
  }

  compileCustomGLSL(node, getInput, nodeId) {
    // Ensure nodeId is sanitized (in case it wasn't passed correctly)
    const sanitizedNodeId = nodeId || node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    // Get custom code from node first to analyze what types are needed
    let code = node.params?.code || node.code || "input0";
    if (typeof code !== 'string') {
      code = String(code);
    }
    
    // If code is empty or only whitespace/comments, provide a default
    if (!code.trim() || code.trim().split('\n').every(line => line.trim().startsWith('//') || !line.trim())) {
      code = "0.0";
    }
    
    // Debug logging
    if (window.DEBUG_CUSTOM_GLSL) {
      console.log(`[CustomGLSL] Compiling node ${sanitizedNodeId}:`, {
        nodeId: node.id,
        sanitizedNodeId,
        codeLength: code.length,
        codePreview: code.substring(0, 100)
      });
    }

    // Analyze code to determine expected input types based on usage
    const inferInputType = (inputIndex) => {
      const inputName = `input${inputIndex}`;
      // Match patterns like input0.x, input0.y, (input0).x, input0.r, etc.
      // Look for input name followed by optional parentheses/whitespace, then dot, then component.
      // The whole swizzle is captured, not just its first letter: `input0.xy` is the usual way an
      // input says it is a vec2, and matching only a single component missed it entirely (the
      // trailing \b cannot follow the `x` of `.xy`), so the pin defaulted to a scalar and `.xy` was
      // then taken of an f32.
      const inputPattern = new RegExp(`\\b${inputName}\\b[^\\s]*\\.([xyzwrgba]+)\\b`, 'g');
      let match;
      const components = new Set();

      while ((match = inputPattern.exec(code)) !== null) {
        for (const component of match[1] || '') {
          components.add(component);
        }
      }
      
      // Check for function calls that require vector types
      // Functions that typically use vec2: distance, length, normalize, etc.
      // Check if input is used in functions that require vec2
      // Also check for arithmetic operations with vec2 literals
      if (components.size === 0) {
        // Check for distance(vec2, vec2) - very common pattern
        const distancePattern = new RegExp(`\\bdistance\\s*\\([^)]*\\b${inputName}\\b`, 'g');
        if (distancePattern.test(code)) {
          return 'vec2'; // distance requires vec2 arguments
        }
        
        // Check for length(vec2) - common pattern
        // Also check for length(input - vec2(...)) or length(vec2(...) - input)
        const lengthPattern = new RegExp(`\\blength\\s*\\([^)]*\\b${inputName}\\b`, 'g');
        if (lengthPattern.test(code)) {
          // Check if input is used in arithmetic with vec2
          const vec2ArithPattern = new RegExp(`\\b${inputName}\\s*[-+*/]\\s*vec2\\s*<`, 'g');
          const vec2ArithPattern2 = new RegExp(`vec2\\s*<[^>]+>\\s*[-+*/]\\s*\\b${inputName}\\b`, 'g');
          if (vec2ArithPattern.test(code) || vec2ArithPattern2.test(code)) {
            return 'vec2'; // Definitely vec2 if used in arithmetic with vec2
          }
          // If used in length() without component access, likely vec2
          return 'vec2';
        }
        
        // Check for normalize(vec2)
        const normalizePattern = new RegExp(`\\bnormalize\\s*\\([^)]*\\b${inputName}\\b`, 'g');
        if (normalizePattern.test(code)) {
          return 'vec2'; // normalize with vec2 is common
        }
        
        // Check for arithmetic operations with vec2 literals (e.g., input0 - vec2<f32>(5.0, 5.0))
        // This is a strong indicator that input0 should be vec2
        // Pattern: input0 - vec2<...> or vec2<...> - input0
        const vec2ArithPattern = new RegExp(`\\b${inputName}\\s*[-+*/]\\s*vec2\\s*<`, 'g');
        const vec2ArithPattern2 = new RegExp(`vec2\\s*<[^>]+>\\s*[-+*/]\\s*\\b${inputName}\\b`, 'g');
        // Also check for patterns like length(input0 - vec2(...)) or distance(input0, vec2(...))
        // This is more specific - if input0 is used in length() with vec2 arithmetic, it must be vec2
        const vec2InLengthPattern = new RegExp(`length\\s*\\([^)]*\\b${inputName}\\b[^)]*[-+*/]\\s*vec2\\s*<`, 'g');
        const vec2InLengthPattern2 = new RegExp(`length\\s*\\([^)]*vec2\\s*<[^)]*[-+*/]\\s*\\b${inputName}\\b`, 'g');
        // Check for distance(input0, vec2(...)) or distance(vec2(...), input0)
        const vec2InDistancePattern = new RegExp(`distance\\s*\\([^,)]*\\b${inputName}\\b[^,)]*,\\s*vec2\\s*<`, 'g');
        const vec2InDistancePattern2 = new RegExp(`distance\\s*\\([^,)]*vec2\\s*<[^,)]*,\\s*\\b${inputName}\\b`, 'g');
        if (vec2ArithPattern.test(code) || vec2ArithPattern2.test(code) || 
            vec2InLengthPattern.test(code) || vec2InLengthPattern2.test(code) ||
            vec2InDistancePattern.test(code) || vec2InDistancePattern2.test(code)) {
          return 'vec2'; // If used in arithmetic with vec2, it must be vec2
        }
      }
      
      if (components.size === 0) {
        return null; // No type hints, use default
      }

      // Determine type based on components accessed
      if (components.has('x') || components.has('y') || components.has('z') || components.has('w')) {
        if (components.has('w')) return 'vec4';
        if (components.has('z')) return 'vec3';
        if (components.has('y')) return 'vec2';
        if (components.has('x')) return 'vec2'; // If only x, assume vec2 (common for UV)
      }
      
      if (components.has('r') || components.has('g') || components.has('b') || components.has('a')) {
        if (components.has('a')) return 'vec4';
        if (components.has('b')) return 'vec3';
        return 'vec3'; // RGB
      }

      return null;
    };

    // Get appropriate defaults based on inferred types
    const getDefaultForType = (type) => {
      switch (type) {
        case 'vec2': return 'vec2<f32>(0.0)';
        case 'vec3': return 'vec3<f32>(0.0)';
        case 'vec4': return 'vec4<f32>(0.0)';
        default: return '0.0';
      }
    };

    // One input variable per pin. The pin list is expandable (the node's "+" chip), so the code
    // substitutes however many the node currently has instead of a fixed input0..input3.
    // When a type is inferred, pass null as targetType to let getInput handle conversion but
    // provide the correct default value.
    const inputCount = Math.max(1, getInputCount(node));

    // A pin whose type the code declares outright (the AI node generator writes these; nothing
    // stops a project file carrying them). Guessing from usage is a fallback for hand-written code,
    // and a poor one — code that only ever says `input0 * 2.0` gives the guesser nothing to go on,
    // so a vec2 pin came out a scalar and every later line was a type error.
    const declaredTypes = Array.isArray(node.params?.inputTypes) ? node.params.inputTypes : [];
    const declaredTypeFor = (index) =>
      (['f32', 'vec2', 'vec3', 'vec4'].includes(declaredTypes[index]) ? declaredTypes[index] : null);

    // Types are inferred from the ORIGINAL code, before any substitution rewrites the input names
    // the inference patterns look for.
    const inputCodes = [];
    for (let i = 0; i < inputCount; i++) {
      const inputType = declaredTypeFor(i) || inferInputType(i);
      const input = getInput(i, inputType || null, getDefaultForType(inputType));
      inputCodes.push(typeof input === 'object' && input?.code !== undefined ? input.code : input);
    }

    // Highest index first: the word boundaries already keep `input1` from matching inside
    // `input10`, and this keeps that true even if the pattern is ever loosened.
    for (let i = inputCount - 1; i >= 0; i--) {
      code = code.replace(new RegExp(`\\binput${i}\\b`, 'g'), `(${inputCodes[i]})`);
    }


    // Replace built-in variables with their shader equivalents. Locals the code declares itself
    // (`let uv = ...`) keep their own meaning — see substituteShaderBuiltins.
    code = substituteShaderBuiltins(code, CUSTOM_CODE_BUILTINS);

    // Get output type from parameter
    const outputType = node.params?.outputType || "f32";
    const validOutputType = ['f32', 'vec2', 'vec3', 'vec4'].includes(outputType) ? outputType : 'f32';

    // Split code into lines, but preserve multi-line expressions
    // First, remove comments
    const linesWithoutComments = code.split('\n')
      .map(line => {
        // Remove inline comments (// ...)
        const commentIndex = line.indexOf('//');
        if (commentIndex >= 0) {
          return line.substring(0, commentIndex).trim();
        }
        return line.trim();
      })
      .filter(line => line.length > 0);
    
    // Now reconstruct multi-line expressions
    // Track parentheses/braces/brackets to know when we're in a multi-line expression
    let reconstructedLines = [];
    let currentExpression = '';
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    
    for (let i = 0; i < linesWithoutComments.length; i++) {
      const line = linesWithoutComments[i];
      const trimmedLine = line.trim();
      
      // Count parentheses, braces, and brackets in this line
      let lineParenDepth = 0;
      let lineBraceDepth = 0;
      let lineBracketDepth = 0;
      
      for (const char of line) {
        if (char === '(') lineParenDepth++;
        if (char === ')') lineParenDepth--;
        if (char === '{') lineBraceDepth++;
        if (char === '}') lineBraceDepth--;
        // KNOWN LIMITATION: '<' and '>' are counted as generic-type delimiters
        // (vec2<f32>) so that a type spanning lines isn't split mid-expression.
        // But the same characters are also comparison/shift operators in WGSL,
        // and this counter cannot tell them apart. A multi-line CustomGLSL
        // expression that uses '<' or '>' for comparison (e.g. a final line like
        // "a > b" following an earlier line) leaves bracketDepth != 0, so the
        // reconstruction never marks the expression "complete" and wrongly merges
        // it with adjacent lines. Single-line expressions are unaffected (they
        // fall through to the trailing flush below). Fixing this properly needs a
        // real tokenizer that distinguishes generic brackets from operators;
        // left as-is for now since multi-line comparisons in CustomGLSL are rare.
        if (char === '<') lineBracketDepth++;
        if (char === '>') lineBracketDepth--;
      }
      
      // Update global depths
      parenDepth += lineParenDepth;
      braceDepth += lineBraceDepth;
      bracketDepth += lineBracketDepth;
      
      // Add to current expression
      if (currentExpression) {
        // Add space between lines, but preserve structure
        currentExpression += ' ' + line;
      } else {
        currentExpression = line;
      }
      
      // Check if this is a complete expression
      // It's complete if:
      // 1. All parentheses/braces/brackets are closed (depth = 0), AND
      // 2. The line doesn't end with a comma (which indicates continuation), AND
      // 3. Either the line ends with semicolon OR it's a complete expression
      // BUT: Don't split if we're inside a for/if/while/loop block (braceDepth > 0)
      // unless we've closed all braces
      const endsWithComma = trimmedLine.endsWith(',');
      // Only consider complete if all braces are closed (we're not inside a block)
      const isComplete = parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && !endsWithComma;
      
      if (isComplete) {
        // Remove trailing semicolon if present (we'll add it when needed)
        const cleaned = currentExpression.trim().replace(/;+$/, '');
        reconstructedLines.push(cleaned);
        currentExpression = '';
        // Reset depths
        parenDepth = 0;
        braceDepth = 0;
        bracketDepth = 0;
      }
    }
    
    // If there's a remaining expression (unclosed), add it anyway
    if (currentExpression) {
      const cleaned = currentExpression.trim().replace(/;+$/, '');
      reconstructedLines.push(cleaned);
    }
    
    const codeLines = reconstructedLines;
    
    let compiledCode;
    
    if (codeLines.length > 1) {
      // Multi-line code - process intermediate lines and final expression
      // The last non-comment line should be the return value
      const lastLine = codeLines[codeLines.length - 1];
      const otherLines = codeLines.slice(0, -1);
      
      // Check if code contains statements (var, for, if, etc.) that need block scope
      const hasStatements = codeLines.some(line => 
        /^\s*(var|for|if|while|loop|switch|break|continue|return|discard)\b/.test(line)
      );
      
      if (hasStatements) {
        // Code contains statements - need to use a block scope
        // Process statements and expressions, replacing variable references
        const varMap = new Map(); // Map original var names to sanitized names
        
        // First pass: identify all variable declarations (let and var)
        // Also check which variables are assigned to later (need to be var, not let)
        const assignedVars = new Set();
        otherLines.forEach((line) => {
          // Check for assignment statements (variable = ...)
          const assignmentMatch = line.match(/^(\w+)\s*=\s*(.+);?$/);
          if (assignmentMatch) {
            assignedVars.add(assignmentMatch[1]);
          }
        });
        
        otherLines.forEach((line, idx) => {
          const letMatch = line.match(/let\s+(\w+)\s*=\s*(.+);?$/);
          const varMatch = line.match(/var\s+(\w+)\s*[=:]\s*(.+);?$/);
          if (letMatch) {
            const varName = letMatch[1];
            // If this variable is assigned to later, we need to track it as a var, not let
            if (assignedVars.has(varName)) {
              // This will be converted to var in the second pass
              varMap.set(varName, varName); // Keep original name for var
            } else {
              const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
              varMap.set(varName, sanitizedVarName);
            }
          } else if (varMatch) {
            const varName = varMatch[1];
            // Keep var declarations as-is (they're mutable), but track the name
            // Don't sanitize var names - they need to stay as-is for the block scope
            varMap.set(varName, varName);
          }
        });
        
        // Second pass: process each line
        const processedLines = [];
        otherLines.forEach((line, idx) => {
          // Trim the line for checking
          const trimmedLine = line.trim();
          
          // Check if it's a statement (var, for, if, etc.)
          const isStatement = /^(var|for|if|while|loop|switch|break|continue|return|discard)\b/.test(trimmedLine);
          
          if (isStatement) {
            // It's a statement - keep as-is but replace variable references
            // For statements with braces (for, if, while, etc.), the entire statement
            // including its body should be on one line (reconstructed by line reconstruction)
            let processedLine = line;
            const sortedVars = Array.from(varMap.entries()).reverse();
            for (const [original, sanitized] of sortedVars) {
              // Only replace if it's not the declaration itself
              // Check for var/let declarations more carefully - match the exact pattern
              const declarationPattern = new RegExp(`\\b(var|let)\\s+${original}\\b`);
              const isDeclaration = declarationPattern.test(line);
              
              if (!isDeclaration) {
                // Replace variable references, but be careful with word boundaries
                // For statements with braces, we need to replace references inside the body too
                processedLine = processedLine.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
              }
            }
            processedLines.push(processedLine);
          } else {
            // Check if it's an assignment statement (variable = expression;)
            // This is different from a let declaration - assignments modify existing variables
            const assignmentMatch = line.match(/^(\w+)\s*=\s*(.+);?$/);
            if (assignmentMatch) {
              const varName = assignmentMatch[1];
              let varValue = assignmentMatch[2];
              
              // Replace variable references in the value
              const sortedVars = Array.from(varMap.entries()).reverse();
              for (const [original, sanitized] of sortedVars) {
                // Replace references to other variables, but keep the target variable name as-is
                if (original !== varName) {
                  varValue = varValue.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
                }
              }
              
              // Keep assignment as-is (it modifies an existing variable)
              processedLines.push(`${varName} = ${varValue};`);
            } else {
              // It's a let declaration or expression
              const letMatch = line.match(/let\s+(\w+)\s*=\s*(.+);?$/);
              if (letMatch) {
                const varName = letMatch[1];
                let varValue = letMatch[2];
                
                // If this variable is assigned to later, convert let to var
                if (assignedVars.has(varName)) {
                  // Convert to var - keep original name
                  const sortedVars = Array.from(varMap.entries()).reverse();
                  for (const [original, sanitized] of sortedVars) {
                    if (original !== varName) {
                      varValue = varValue.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
                    }
                  }
                  processedLines.push(`var ${varName} = ${varValue};`);
                } else {
                  // Regular let declaration - sanitize the name
                  const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
                  
                  // Replace variable references in the value
                  const sortedVars = Array.from(varMap.entries()).reverse();
                  for (const [original, sanitized] of sortedVars) {
                    if (original !== varName) {
                      varValue = varValue.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
                    }
                  }
                  
                  processedLines.push(`let ${sanitizedVarName} = ${varValue};`);
                  varMap.set(varName, sanitizedVarName);
                }
              } else {
                // Pure expression - create a temp variable
                let expression = line;
                const sortedVars = Array.from(varMap.entries()).reverse();
                for (const [original, sanitized] of sortedVars) {
                  expression = expression.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
                }
                const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
                processedLines.push(`let ${sanitizedVarName} = ${expression};`);
                // Note: we don't add to varMap for pure expressions
              }
            }
          }
        });
        
        // Process the last line
        let finalExpression = lastLine;
        const sortedVars = Array.from(varMap.entries()).reverse();
        for (const [original, sanitized] of sortedVars) {
          finalExpression = finalExpression.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
        }
        
        // Remove "let" or "var" from final expression if present
        const finalLetMatch = finalExpression.match(/let\s+\w+\s*=\s*(.+);?$/);
        const finalVarMatch = finalExpression.match(/var\s+\w+\s*[=:]\s*(.+);?$/);
        if (finalLetMatch) {
          finalExpression = finalLetMatch[1];
        } else if (finalVarMatch) {
          finalExpression = finalVarMatch[1];
        }
        
        // Wrap in a block - but node_X needs to be accessible outside
        // Use var so we can assign it inside the block
        // Get default value for the output type
        const getDefaultForOutputType = (type) => {
          switch (type) {
            case 'vec2': return 'vec2<f32>(0.0)';
            case 'vec3': return 'vec3<f32>(0.0)';
            case 'vec4': return 'vec4<f32>(0.0)';
            default: return '0.0';
          }
        };
        const defaultValue = getDefaultForOutputType(validOutputType);
        // Ensure all statements end with semicolons (except blocks)
        const formattedLines = processedLines.map(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.endsWith(';') && !trimmed.endsWith('}') && !trimmed.endsWith('{')) {
            return line + ';';
          }
          return line;
        });
        // Build block content: all processed lines, then assign final expression to node_X
        // Make sure final expression is properly formatted
        const finalAssignment = `node_${sanitizedNodeId} = ${finalExpression};`;
        const blockContentLines = [...formattedLines, finalAssignment];
        // Join with newlines and proper indentation
        const blockContent = blockContentLines.join('\n  ');
        // The entire block (var declaration + block) should be a single line in the lines array
        // The newlines inside will be preserved when inserted into the shader
        compiledCode = `var node_${sanitizedNodeId}: ${validOutputType} = ${defaultValue};
{
  ${blockContent}
}`;
      } else {
        // No statements - just expressions and let declarations
        // Process intermediate lines - they should be let declarations
        const intermediateDeclarations = [];
        const varMap = new Map(); // Map original var names to sanitized names
        
        // First pass: identify all variable declarations and create the map
        otherLines.forEach((line, idx) => {
          const letMatch = line.match(/let\s+(\w+)\s*=\s*(.+);?$/);
          if (letMatch) {
            const varName = letMatch[1];
            const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
            varMap.set(varName, sanitizedVarName);
          }
        });
        
        // Second pass: process each line, replacing variable references with sanitized names
        otherLines.forEach((line, idx) => {
          const letMatch = line.match(/let\s+(\w+)\s*=\s*(.+);?$/);
          if (letMatch) {
            const varName = letMatch[1];
            let varValue = letMatch[2];
            const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
            
            // Replace any variable references in the value with their sanitized names
            const sortedVars = Array.from(varMap.entries()).reverse();
            for (const [original, sanitized] of sortedVars) {
              if (original !== varName) {
                varValue = varValue.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
              }
            }
            
            intermediateDeclarations.push(`let ${sanitizedVarName} = ${varValue};`);
          } else {
            // Not a let declaration - treat as expression and create a temp variable
            let expression = line;
            const sortedVars = Array.from(varMap.entries()).reverse();
            for (const [original, sanitized] of sortedVars) {
              expression = expression.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
            }
            const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
            intermediateDeclarations.push(`let ${sanitizedVarName} = ${expression};`);
          }
        });
        
        // Process the last line - replace any variable references with sanitized names
        let finalExpression = lastLine;
        const sortedVars = Array.from(varMap.entries()).reverse();
        for (const [original, sanitized] of sortedVars) {
          finalExpression = finalExpression.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
        }
        
        // Remove any "let" declaration from final expression if present
        const finalMatch = finalExpression.match(/let\s+\w+\s*=\s*(.+);?$/);
        if (finalMatch) {
          finalExpression = finalMatch[1];
        }
        
        // Combine all declarations - node_X must be at top level, not in a block
        compiledCode = intermediateDeclarations.join('\n') + `\nlet node_${sanitizedNodeId} = ${finalExpression};`;
      }
    } else if (codeLines.length === 1) {
      // Single line - just assign
      compiledCode = `let node_${sanitizedNodeId} = ${codeLines[0]};`;
    } else {
      // Empty code - use default
      compiledCode = `let node_${sanitizedNodeId} = 0.0;`;
    }
    
    // Ensure we always return a valid result
    if (!compiledCode || !compiledCode.trim()) {
      compiledCode = `let node_${sanitizedNodeId} = ${getDefaultForType(validOutputType)};`;
    }

    // Double-check that the line contains the variable declaration
    if (!compiledCode.includes(`node_${sanitizedNodeId}`)) {
      console.warn(`[CustomGLSL] Node ${sanitizedNodeId} did not generate proper variable declaration. Generated code:`, compiledCode);
      compiledCode = `let node_${sanitizedNodeId} = ${getDefaultForType(validOutputType)};`;
    }

    // GUARD: the editor recompiles on every keystroke (debounced), so it constantly
    // sees half-finished expressions while the user types — a trailing operator
    // ("input0 +" -> `(0.0) +;`), an unclosed call ("sin(input0" -> `sin((0.0);`),
    // a dangling member access ("input0." -> `(0.0).;`). Emitting these produces
    // invalid WGSL that WebGPU rejects, spamming the console with shader-compile
    // errors ("unable to parse right side of + expression") on each keystroke.
    // Substitute a harmless default of the declared output type until the
    // expression is syntactically complete again — same spirit as the "=node_"
    // partial-reference fallback in NodeCompiler.resolveParameterValue.
    if (this.isIncompleteWGSLExpression(compiledCode)) {
      compiledCode = `let node_${sanitizedNodeId} = ${getDefaultForType(validOutputType)};`;
    }

    // Debug logging
    if (window.DEBUG_CUSTOM_GLSL) {
      console.log(`[CustomGLSL] Node ${sanitizedNodeId} compiled:`, {
        line: compiledCode.substring(0, 200),
        outputType: validOutputType
      });
    }
    
    return {
      line: compiledCode,
      outputType: validOutputType
    };
  }

  /**
   * Heuristic check for an obviously-incomplete WGSL expression, of the kind the
   * live recompile produces while the user is still typing in the CustomGLSL
   * editor. Deliberately conservative — it only flags clear-cut "unfinished"
   * shapes so that valid code is never rejected:
   *   - unbalanced (), [] or {}            e.g. "sin(input0"  -> `sin((0.0)`
   *   - a binary operator before ';'       e.g. "input0 +"    -> `(0.0) +;`
   *   - an empty right-hand side           e.g. "="           -> `= ;`
   *   - an unfinished member/swizzle access e.g. "input0."    -> `(0.0).;`
   *
   * Angle brackets are intentionally NOT balance-checked: '<' and '>' double as
   * comparison operators and generic delimiters (vec3<f32>), so counting them
   * yields false positives on valid code.
   *
   * @param {string} code - The generated WGSL line(s) for this node
   * @returns {boolean} true if the code looks unfinished
   */
  isIncompleteWGSLExpression(code) {
    if (!code || !code.trim()) return true;

    // Unbalanced brackets — an open call/subscript/block that hasn't been closed.
    let paren = 0, square = 0, brace = 0;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') paren++;
      else if (ch === ')') paren--;
      else if (ch === '[') square++;
      else if (ch === ']') square--;
      else if (ch === '{') brace++;
      else if (ch === '}') brace--;
      if (paren < 0 || square < 0 || brace < 0) return true; // closed before opened
    }
    if (paren !== 0 || square !== 0 || brace !== 0) return true;

    // A binary operator immediately before a statement terminator means its
    // right-hand operand is missing. The generated code always terminates
    // statements with ';', so checking there covers every code path.
    if (/[+\-*/%&|^=]\s*;/.test(code)) return true;

    // An empty right-hand side: "= ;".
    if (/=\s*;/.test(code)) return true;

    // An unfinished member/swizzle access: a dot right before ';' preceded by an
    // identifier, ')' or ']'. A digit before the dot is excluded so the float
    // literal "2." is not mistaken for incomplete access.
    if (/[)\]a-zA-Z_]\.\s*;/.test(code)) return true;

    return false;
  }
}
