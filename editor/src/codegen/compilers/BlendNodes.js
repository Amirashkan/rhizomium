// src/codegen/compilers/BlendNodes.js
// NEW FILE - Compiler for blend operations

import { UnifiedParameterHandler } from '../../parameters/UnifiedParameterHandler.js';

export class BlendNodes {
  constructor() {
    this.uniformManager = null;
    this.paramHandler = new UnifiedParameterHandler();
  }

  setUniformManager(manager) {
    this.uniformManager = manager;
  }

  setExpressionSystem(expressionSystem) {
    this.paramHandler.setExpressionSystem(expressionSystem);
  }

  handles(kind) {
    return [
      'SDFUnion', 'SDFIntersection',
      'SDFSmoothUnion', 'SDFSmoothIntersection', 'SDFSmoothSubtraction'
    ].includes(kind);
  }

  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

    if (this.uniformManager) {
      this.uniformManager.analyzeNode(node);
    }

    switch (node.kind) {
      case 'SDFUnion':
        return this.compileUnion(node, getInput, nodeId);
      case 'SDFIntersection':
        return this.compileIntersection(node, getInput, nodeId);
      case 'SDFSmoothUnion':
        return this.compileSmoothUnion(node, getInput, nodeId);
      case 'SDFSmoothIntersection':
        return this.compileSmoothIntersection(node, getInput, nodeId);
      case 'SDFSmoothSubtraction':
        return this.compileSmoothSubtraction(node, getInput, nodeId);
      default:
        return null;
    }
  }

  getParam(node, paramName, defaultValue) {
    const rawValue = node.params?.[paramName] ?? defaultValue;

    // Check for time-based expressions
    if (typeof rawValue === 'string' && (/time|audioEnvelope/.test(rawValue))) {
      const shaderExpr = rawValue
        .replace(/\bsin\(/g, 'sin(')
        .replace(/\bcos\(/g, 'cos(')
        .replace(/\btime\b/g, 'g.time')
        .replace(/\baudioEnvelopeBass\b/g, 'g.audioEnvelopeBass')
        .replace(/\baudioEnvelopeMids\b/g, 'g.audioEnvelopeMids')
        .replace(/\baudioEnvelopeHighs\b/g, 'g.audioEnvelopeHighs')
        .replace(/\baudioEnvelopeFull\b/g, 'g.audioEnvelopeFull')
        .replace(/\baudioEnvelope\b/g, 'g.audioEnvelope');
      return shaderExpr;
    }

    // PERFORMANCE FIX: Check if it's an expression (starts with =)
    if (typeof rawValue === 'string' && rawValue.trim().startsWith('=')) {
      // Handle expressions using the paramHandler
      const result = this.paramHandler.toShaderCode(node.kind, paramName, rawValue, null);
      return typeof result === 'number' ? result.toFixed(6) : result;
    }

    // PERFORMANCE FIX: Register ALL numeric parameters as uniforms!
    if (this.uniformManager) {
      let value = rawValue;

      // Parse string values to numbers
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        value = isNaN(parsed) ? (typeof defaultValue === 'number' ? defaultValue : 0.0) : parsed;
      }

      // Convert to number
      if (typeof value !== 'number') {
        value = typeof defaultValue === 'number' ? defaultValue : 0.0;
      }

      // Ensure finite value
      if (!isFinite(value)) {
        value = 0.0;
      }

      // Register with uniform manager
      const paramKey = `${node.id}.${paramName}`;
      this.uniformManager.uniformValues.set(paramKey, value);

      // Generate uniform reference
      const sanitizedKey = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
      const fieldName = sanitizedKey.startsWith('_') ? sanitizedKey : `_${sanitizedKey}`;
      return `u_params.${fieldName}`;
    }

    // Fallback: For static params without uniform manager, evaluate and return the value
    const result = this.paramHandler.toShaderCode(node.kind, paramName, rawValue, null);

    if (typeof result === 'number') {
      return result === Math.floor(result) ? `${result}.0` : result.toString();
    }

    return result;
  }

  compileUnion(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    
    const line = `
  let node_${nodeId} = min(${a}, ${b});`;
    
    return { line, outputType: "f32" };
  }

  compileIntersection(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    
    const line = `
  let node_${nodeId} = max(${a}, ${b});`;
    
    return { line, outputType: "f32" };
  }

  compileSmoothUnion(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    const k = this.getParam(node, 'smoothness', 0.1);
    
    const line = `
  let h_${nodeId} = clamp(0.5 + 0.5 * (${b} - ${a}) / ${k}, 0.0, 1.0);
  let node_${nodeId} = mix(${b}, ${a}, h_${nodeId}) - ${k} * h_${nodeId} * (1.0 - h_${nodeId});`;
    
    return { line, outputType: "f32" };
  }

  compileSmoothIntersection(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    const k = this.getParam(node, 'smoothness', 0.1);
    
    const line = `
  let h_${nodeId} = clamp(0.5 - 0.5 * (${b} - ${a}) / ${k}, 0.0, 1.0);
  let node_${nodeId} = mix(${b}, ${a}, h_${nodeId}) + ${k} * h_${nodeId} * (1.0 - h_${nodeId});`;
    
    return { line, outputType: "f32" };
  }

  compileSmoothSubtraction(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    const k = this.getParam(node, 'smoothness', 0.1);
    
    const line = `
  let h_${nodeId} = clamp(0.5 - 0.5 * (${a} + ${b}) / ${k}, 0.0, 1.0);
  let node_${nodeId} = mix(${a}, -${b}, h_${nodeId}) + ${k} * h_${nodeId} * (1.0 - h_${nodeId});`;
    
    return { line, outputType: "f32" };
  }
}