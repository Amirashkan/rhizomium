// src/codegen/compilers/GradientNodes.js
export class GradientNodes {
  constructor() {
    this.uniformManager = null;
  }

  setUniformManager(manager) {
    this.uniformManager = manager;
  }

  handles(kind) {
    return ['LinearGradient', 'RadialGradient', 'AngularGradient', 'ConicGradient'].includes(kind);
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
        return window.unifiedExpressionSystem.generateShader(value);
      } catch (error) {
        console.warn('Failed to generate shader for expression:', value, error);
        return String(defaultValue);
      }
    }

    // Handle expressions without = prefix (like "time" or "audioEnvelope*2")
    if (typeof value === 'string' && (/\btime\b/.test(value) || /audioEnvelope/.test(value))) {
      try {
        return window.unifiedExpressionSystem.generateShader(value);
      } catch (error) {
        console.warn('Failed to generate shader for expression:', value, error);
        return String(defaultValue);
      }
    }

    // Return numeric value as string
    return String(value);
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
      case 'LinearGradient':
        return this.compileLinearGradient(node, getInput, nodeId);
      case 'RadialGradient':
        return this.compileRadialGradient(node, getInput, nodeId);
      case 'AngularGradient':
        return this.compileAngularGradient(node, getInput, nodeId);
      case 'ConicGradient':
        return this.compileConicGradient(node, getInput, nodeId);
      default:
        return null;
    }
  }
  
  compileLinearGradient(node, getInput, nodeId) {
    const angleDeg = this.getShaderParam(node, 'angle', 0.0);
    const offset = this.getShaderParam(node, 'offset', 0.0);
    const scale = this.getShaderParam(node, 'scale', 1.0);

    // Convert angle from degrees to radians
    const angle = this.convertDegToRad(angleDeg);

    return {
      line: `
  let dir_${nodeId} = vec2<f32>(cos(${angle}), sin(${angle}));
  let proj_${nodeId} = dot(in.uv - vec2<f32>(0.5), dir_${nodeId}) * ${scale} + ${offset};
  let node_${nodeId} = proj_${nodeId};`,
      outputType: "f32"
    };
  }
  
  compileRadialGradient(node, getInput, nodeId) {
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);
    const radius = this.getShaderParam(node, 'radius', 0.5);
    const falloff = this.getShaderParam(node, 'falloff', 1.0);

    return {
      line: `
  let center_${nodeId} = vec2<f32>(${centerX}, ${centerY});
  let dist_${nodeId} = length(in.uv - center_${nodeId}) / ${radius};
  let node_${nodeId} = pow(clamp(dist_${nodeId}, 0.0, 1.0), ${falloff});`,
      outputType: "f32"
    };
  }
  
  compileAngularGradient(node, getInput, nodeId) {
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);
    const rotationDeg = this.getShaderParam(node, 'rotation', 0.0);
    const repeat = this.getShaderParam(node, 'repeat', 1.0);

    // Convert rotation from degrees to radians
    const rotation = this.convertDegToRad(rotationDeg);

    return {
      line: `
  let center_${nodeId} = vec2<f32>(${centerX}, ${centerY});
  let angle_${nodeId} = atan2(in.uv.y - center_${nodeId}.y, in.uv.x - center_${nodeId}.x) + ${rotation};
  let node_${nodeId} = fract((angle_${nodeId} / (3.14159265359 * 2.0) + 0.5) * ${repeat});`,
      outputType: "f32"
    };
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