// src/codegen/compilers/GradientNodes.js
export class GradientNodes {
  constructor() {
    this.uniformManager = null;
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

  handles(kind) {
    return ['ConicGradient'].includes(kind);
  }

  /**
   * Get parameter value with default fallback
   */
  getParam(node, name, defaultValue) {
    const value = node.params?.[name] ?? defaultValue;
    if (typeof value === 'boolean') return value;
    return value;
  }

  /**
   * Get parameter as shader code, supporting expressions
   * USE UNIFIED AST SYSTEM - This ensures shader code matches CPU evaluation exactly.
   */
  getShaderParam(node, name, defaultValue) {
    const value = this.getParam(node, name, defaultValue);

    // Handle expressions with = prefix (like "=node_14" or "=audioEnvelope*5")
    if (typeof value === 'string' && value.startsWith('=')) {
      try {
        return window.unifiedExpressionSystem.generateShader(value, {}, this.graph);
      } catch (error) {

        return String(defaultValue);
      }
    }

    // Handle expressions without = prefix (like "time" or "audioEnvelope*2")
    if (typeof value === 'string' && (/\btime\b/.test(value) || /audioEnvelope/.test(value))) {
      try {
        return window.unifiedExpressionSystem.generateShader(value, {}, this.graph);
      } catch (error) {

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
   * Convert angle parameter from degrees to radians
   * Handles both static values and dynamic expressions
   */
  convertDegToRad(angleDeg) {
    const isUniformRef = typeof angleDeg === 'string' && angleDeg.includes('u_params.');
    if (isUniformRef) {
      // If it's a uniform reference, add conversion in shader
      return `(${angleDeg} * ${Math.PI / 180})`;
    }

    const degValue = parseFloat(angleDeg);
    if (!isNaN(degValue)) {
      // Static numeric value - convert now
      return (degValue * Math.PI / 180).toString();
    }

    // Expression - add conversion wrapper
    return `(${angleDeg} * ${Math.PI / 180})`;
  }

  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

    switch (node.kind) {
      case 'ConicGradient':
        return this.compileConicGradient(node, getInput, nodeId);
      default:
        return null;
    }
  }

  compileConicGradient(node, getInput, nodeId) {
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);
    const startAngleDeg = this.getShaderParam(node, 'startAngle', 0.0);
    const endAngleDeg = this.getShaderParam(node, 'endAngle', 360);

    // Convert angles from degrees to radians
    const startAngle = this.convertDegToRad(startAngleDeg);
    const endAngle = this.convertDegToRad(endAngleDeg);

    return {
      line: `
  let center_${nodeId} = vec2<f32>(${centerX}, ${centerY});
  let angle_${nodeId} = atan2(in.uv.y - center_${nodeId}.y, in.uv.x - center_${nodeId}.x);
  let t_${nodeId} = clamp((angle_${nodeId} - ${startAngle}) / (${endAngle} - ${startAngle}), 0.0, 1.0);
  let node_${nodeId} = t_${nodeId};`,
      outputType: "f32"
    };
  }
}