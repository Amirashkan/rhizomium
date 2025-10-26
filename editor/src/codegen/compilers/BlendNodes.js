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
      'SDFAdd', 'SDFSubtract', 'SDFUnion', 'SDFIntersection',
      'SDFSmoothUnion', 'SDFSmoothIntersection', 'SDFSmoothSubtraction'
    ].includes(kind);
  }

  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    if (this.uniformManager) {
      this.uniformManager.analyzeNode(node);
    }
    
    switch (node.kind) {
      case 'SDFAdd':
        return this.compileAdd(node, getInput, nodeId);
      case 'SDFSubtract':
        return this.compileSubtract(node, getInput, nodeId);
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
    
    const uniformName = this.uniformManager?.isDynamicParam(node.id, paramName)
      ? this.uniformManager.getUniformName(node.id, paramName)
      : null;
    
    if (uniformName) {
      return `params.${uniformName}`;
    }
    
    const result = this.paramHandler.toShaderCode(node.kind, paramName, rawValue, uniformName);
    
    if (typeof result === 'number') {
      return result === Math.floor(result) ? `${result}.0` : result.toString();
    }
    
    return result;
  }

  compileAdd(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    
    const line = `
  let node_${nodeId} = ${a} + ${b};`;
    
    return { line, outputType: "f32" };
  }

  compileSubtract(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    
    const line = `
  let node_${nodeId} = ${a} - ${b};`;
    
    return { line, outputType: "f32" };
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