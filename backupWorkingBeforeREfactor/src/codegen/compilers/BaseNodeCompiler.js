// src/codegen/compilers/BaseNodeCompiler.js
import { TypeConverter, NodeTypes, sanitizeId } from "../../core/TypeSystem.js";

export class CompilerContext {
  constructor(graph, expressions = new Map(), types = new Map()) {
    this.graph = graph;
    this.expressions = expressions; // nodeId -> expression string
    this.types = types; // nodeId -> type string
    this.byId = new Map(graph.nodes.map((n) => [n.id, n]));
  }

  getExpression(nodeId) {
    return this.expressions.get(nodeId) || `node_${sanitizeId(nodeId)}`;
  }

  getType(nodeId) {
    return this.types.get(nodeId) || "f32";
  }

  setResult(nodeId, expression, type) {
    this.expressions.set(nodeId, expression);
    this.types.set(nodeId, type);
  }

  getConnectedInput(node, inputIndex, targetType = null) {
    if (!node.inputs || !node.inputs[inputIndex]) {
      return null;
    }

    const inputNodeId = node.inputs[inputIndex];
    if (!inputNodeId) return null;

    const expr = this.getExpression(inputNodeId);
    const type = this.getType(inputNodeId);

    if (targetType && type !== targetType) {
      return TypeConverter.convert(expr, type, targetType);
    }

    return expr;
  }
}

export class BaseNodeCompiler {
  constructor() {
    this.supportedNodes = [];
  }

  canCompile(nodeKind) {
    return this.supportedNodes.includes(nodeKind);
  }

  compile(node, context) {
    throw new Error(`Compiler for ${node.kind} must implement compile method`);
  }

  getParameterValue(node, paramName, defaultValue = 0) {
    // Check connected inputs first (for parameterized nodes)
    if (paramName === "value" && typeof node.value !== "undefined") {
      return node.value;
    }

    // Check props
    if (node.props && typeof node.props[paramName] !== "undefined") {
      return node.props[paramName];
    }

    // Check direct properties (legacy support)
    if (typeof node[paramName] !== "undefined") {
      return node[paramName];
    }

    return defaultValue;
  }

  formatFloat(value) {
    const num = typeof value === "number" ? value : parseFloat(value) || 0;
    return num.toFixed(6);
  }

  generateVariableName(nodeId) {
    return `node_${sanitizeId(nodeId)}`;
  }
}

// Factory for node compilers
export class NodeCompilerRegistry {
  constructor() {
    this.compilers = new Map();
  }

  register(compiler) {
    compiler.supportedNodes.forEach((nodeKind) => {
      this.compilers.set(nodeKind, compiler);
    });
  }

  getCompiler(nodeKind) {
    return this.compilers.get(nodeKind);
  }

  compile(node, context) {
    const compiler = this.getCompiler(node.kind);
    if (!compiler) {
      throw new Error(`No compiler found for node type: ${node.kind}`);
    }
    return compiler.compile(node, context);
  }

  getAllSupportedNodes() {
    return Array.from(this.compilers.keys());
  }
}
