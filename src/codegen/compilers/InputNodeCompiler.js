// src/codegen/compilers/InputNodeCompiler.js
import { BaseNodeCompiler } from "./BaseNodeCompiler.js";
import { WGSLTypes } from "../../core/TypeSystem.js";

export class ConstantNodeCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = ["ConstFloat", "ConstVec2", "ConstVec3"];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    let expression;
    let outputType;

    switch (node.kind) {
      case "ConstFloat":
        expression = this.compileFloat(node);
        outputType = WGSLTypes.F32;
        break;
      case "ConstVec2":
        expression = this.compileVec2(node);
        outputType = WGSLTypes.VEC2;
        break;
      case "ConstVec3":
        expression = this.compileVec3(node);
        outputType = WGSLTypes.VEC3;
        break;
      default:
        throw new Error(`Unsupported constant node: ${node.kind}`);
    }

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }

  compileFloat(node) {
    const value = this.getParameterValue(node, "value", 0.0);
    return this.formatFloat(value);
  }

  compileVec2(node) {
    const x = this.getParameterValue(node, "x", 0.0);
    const y = this.getParameterValue(node, "y", 0.0);
    return `vec2<f32>(${this.formatFloat(x)}, ${this.formatFloat(y)})`;
  }

  compileVec3(node) {
    // Read from props, NOT coordinates (as per original code)
    const x = this.getParameterValue(node, "x", 0.0);
    const y = this.getParameterValue(node, "y", 0.0);
    const z = this.getParameterValue(node, "z", 0.0);
    return `vec3<f32>(${this.formatFloat(x)}, ${this.formatFloat(y)}, ${this.formatFloat(z)})`;
  }
}

export class SystemInputCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = ["UV", "Time"];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    let expression;
    let outputType;

    switch (node.kind) {
      case "UV":
        expression = "in.uv";
        outputType = WGSLTypes.VEC2;
        break;
      case "Time":
        expression = "u.time";
        outputType = WGSLTypes.F32;
        break;
      default:
        throw new Error(`Unsupported system input: ${node.kind}`);
    }

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }
}

export class ExpressionCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = ["Expr"];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    const expression = this.compileExpression(node, context);
    const outputType = WGSLTypes.F32;

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }

  compileExpression(node, context) {
    const a = context.getConnectedInput(node, 0, WGSLTypes.F32) || "0.0";
    const b = context.getConnectedInput(node, 1, WGSLTypes.F32) || "0.0";

    let expr = this.getParameterValue(node, "expr", "a").toString();

    console.log("Original expression:", expr);

    // Replace variables with connected inputs FIRST (before function replacements)
    expr = expr.replace(/\ba\b/g, `(${a})`);
    expr = expr.replace(/\bb\b/g, `(${b})`);

    // Replace time and UV references
    expr = expr.replace(/\bu_time\b/g, "u.time");
    expr = expr.replace(/\buv\b/g, "in.uv");

    // Replace constants
    expr = expr.replace(/\bpi\b/g, "3.14159265359");
    expr = expr.replace(/\bPI\b/g, "3.14159265359");

    console.log("Final WGSL expression:", expr);

    return expr;
  }
}

export class UtilityNodeCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = ["Split3", "Combine3"];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    let expression;
    let outputType;

    switch (node.kind) {
      case "Split3":
        expression = this.compileSplit3(node, context);
        outputType = WGSLTypes.VEC3;
        break;
      case "Combine3":
        expression = this.compileCombine3(node, context);
        outputType = WGSLTypes.VEC3;
        break;
      default:
        throw new Error(`Unsupported utility node: ${node.kind}`);
    }

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }

  compileSplit3(node, context) {
    const vec =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    // Note: Split3 needs special handling as it has multiple outputs
    return vec;
  }

  compileCombine3(node, context) {
    const x = context.getConnectedInput(node, 0, WGSLTypes.F32) || "0.0";
    const y = context.getConnectedInput(node, 1, WGSLTypes.F32) || "0.0";
    const z = context.getConnectedInput(node, 2, WGSLTypes.F32) || "0.0";
    return `vec3<f32>(${x}, ${y}, ${z})`;
  }
}
