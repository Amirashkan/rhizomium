// src/codegen/compilers/InputNodes.js
import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';
import { buildScalarRefMapping } from '../processors/scalarRef.js';
import { isDisplayMode, getDisplayResolution } from '../../utils/resolutionMode.js';

export class InputNodes {
  constructor() {
    // Graph + TypeConverter for the pass being compiled, used to scalar-coerce node references in
    // these nodes' (all f32) parameter expressions. Set by NodeCompiler before each pass.
    this.graph = null;
    this.typeConverter = null;
  }

  setGraph(graph) {
    this.graph = graph;
  }

  setTypeConverter(typeConverter) {
    this.typeConverter = typeConverter;
  }

  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind
   * @returns {boolean}
   */
  handles(kind) {
    return [
      'UV', 'Time', 'ConstFloat', 'ConstVec2', 'ConstVec3', 'ConstVec4',
      'Mouse', 'Resolution', 'Pi', 'Trigger', 'Hold'
    ].includes(kind);
  }

  /**
   * Format a parameter default as a WGSL float literal, used when an expression can't be resolved.
   */
  _defaultLiteral(defaultValue) {
    if (typeof defaultValue !== 'number') {
      const parsed = parseFloat(defaultValue);
      if (!Number.isFinite(parsed)) return typeof defaultValue === 'string' ? defaultValue : '0.0';
      return Number.isInteger(parsed) ? `${parsed}.0` : `${parsed}`;
    }
    return Number.isInteger(defaultValue) ? `${defaultValue}.0` : `${defaultValue}`;
  }

  /**
   * Resolve a SCALAR parameter expression (these input nodes are all f32) to WGSL, coercing any
   * node reference to a scalar. Without this a reference to a vector node — e.g. a ConstFloat whose
   * value is "=node_<mouse>" (a vec4) — would emit `let node_X = <vec4>;` while the node is typed
   * f32, and a downstream f32 consumer (a Circle radius) would then fail with a type mismatch and
   * blank the render. An unresolvable reference falls back to the default literal.
   */
  _resolveScalarExpr(rawValue, defaultValue) {
    const fallback = this._defaultLiteral(defaultValue);
    const mapping = buildScalarRefMapping(rawValue, this.graph, this.typeConverter);
    if (mapping === null) return fallback;
    try {
      const result = unifiedExpressionSystem.generateShader(rawValue, mapping, this.graph);
      return result === '0.0' ? fallback : result;
    } catch (error) {
      return fallback;
    }
  }

  /**
   * Compile input nodes
   * @param {Object} node
   * @param {Function} getInput
   * @param {Function} getParam - Resolves parameter values (including node references)
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput, getParam = null) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

    // Resolve a scalar parameter. Expression values are scalar-coerced here (so a vector reference
    // can't slip through as the wrong type); plain numbers go through the provided getParam, which
    // registers them as live uniforms.
    const resolveParam = (paramName, defaultValue) => {
      const raw = node.params?.[paramName];
      const isExpr = typeof raw === 'string'
        && (raw.trim().startsWith('=') || /\b(time|audioEnvelope)\b/.test(raw));
      if (isExpr) {
        return this._resolveScalarExpr(raw, defaultValue);
      }
      if (getParam) return getParam(paramName, defaultValue);
      if (typeof raw === 'number') return raw.toFixed(6);
      const parsed = parseFloat(raw);
      return isNaN(parsed) ? defaultValue : parsed.toFixed(6);
    };

    switch (node.kind) {
      case 'UV':
        return {
          line: `let node_${nodeId} = in.uv;`,
          outputType: "vec2"
        };

      case 'Time':
        return {
          line: `let node_${nodeId} = g.time;`,
          outputType: "f32"
        };

      case 'ConstFloat': {
        const value = resolveParam('value', '0.0');
        return {
          line: `let node_${nodeId} = ${value};`,
          outputType: "f32"
        };
      }

      case 'ConstVec2': {
        const x = resolveParam('x', '0.0');
        const y = resolveParam('y', '0.0');
        return {
          line: `let node_${nodeId} = vec2<f32>(${x}, ${y});`,
          outputType: "vec2"
        };
      }

      case 'ConstVec3': {
        const x = resolveParam('x', '0.0');
        const y = resolveParam('y', '0.0');
        const z = resolveParam('z', '0.0');
        return {
          line: `let node_${nodeId} = vec3<f32>(${x}, ${y}, ${z});`,
          outputType: "vec3"
        };
      }

      case 'ConstVec4': {
        const x = resolveParam('x', '0.0');
        const y = resolveParam('y', '0.0');
        const z = resolveParam('z', '0.0');
        const w = resolveParam('w', '1.0');
        return {
          line: `let node_${nodeId} = vec4<f32>(${x}, ${y}, ${z}, ${w});`,
          outputType: "vec4"
        };
      }
        
      case 'Mouse':
        return {
          line: `let node_${nodeId} = g.mouse;`,
          outputType: "vec4"
        };
        
      case 'Resolution': {
        // Two modes (see the node's `mode` param):
        //   Preview - the live render canvas size from g.resolution (default).
        //   Display - the monitor's actual native resolution, baked as a constant
        //             at compile time (it doesn't change frame-to-frame).
        // Either way the node's declared pins are res (vec2), width, height, aspect, and
        // each gets its own expression so downstream f32 consumers get the real component
        // instead of a vec2->f32 average.
        let source = 'g.resolution';
        if (isDisplayMode(node)) {
          const { width, height } = getDisplayResolution();
          source = `vec2<f32>(${width}.0, ${height}.0)`;
        }
        return {
          line: `let node_${nodeId} = ${source};`,
          outputType: "vec2",
          outputPins: [
            { expression: `node_${nodeId}`, type: "vec2" },                    // res
            { expression: `node_${nodeId}.x`, type: "f32" },                   // width
            { expression: `node_${nodeId}.y`, type: "f32" },                   // height
            { expression: `(node_${nodeId}.x / node_${nodeId}.y)`, type: "f32" }, // aspect
          ]
        };
      }
        
      case 'Pi':
        return {
          line: `let node_${nodeId} = 3.14159265359;`,
          outputType: "f32"
        };

      case 'Trigger': {
        const input = getInput(0, 'f32', '0.0');
        const threshold = resolveParam('threshold', '0.5');
        return {
          line: `let node_${nodeId} = select(0.0, 1.0, ${input} >= ${threshold});`,
          outputType: "f32"
        };
      }

      case 'Hold': {
        // Sample-and-hold needs state across frames, which a fragment shader has none of: the
        // held value is computed on the CPU each frame (HoldNodeProcessor evaluates the value /
        // pulse inputs, applies the rising-edge / continuous latch, and keeps holding after the
        // pulse falls to 0) and streamed in as a per-frame uniform. The shader just reads it.
        // getParam registers the "hold" uniform (node.id + ".hold") that the processor writes to.
        const holdRef = getParam ? getParam('hold', 0.0) : null;
        if (holdRef) {
          return { line: `let node_${nodeId} = ${holdRef};`, outputType: "f32" };
        }
        // Fallback (uniform registration unavailable): latch the value while the pulse is high.
        const value = getInput(0, 'f32', '0.0');
        const pulse = getInput(1, 'f32', '0.0');
        const threshold = resolveParam('threshold', '0.5');
        return {
          line: `let node_${nodeId} = select(0.0, ${value}, ${pulse} >= ${threshold});`,
          outputType: "f32"
        };
      }

      default:
        return null;
    }
  }
}
