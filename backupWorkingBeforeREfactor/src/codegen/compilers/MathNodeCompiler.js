// src/codegen/compilers/MathNodeCompiler.js
import { BaseNodeCompiler } from "./BaseNodeCompiler.js";
import { WGSLTypes, TypeConverter } from "../../core/TypeSystem.js";

export class ScalarMathCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = [
      "Sin",
      "Cos",
      "Tan",
      "Floor",
      "Fract",
      "Abs",
      "Sqrt",
      "Pow",
      "Min",
      "Max",
      "Clamp",
      "Smoothstep",
      "Step",
      "Sign",
      "Mod",
    ];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    let expression;
    let outputType = WGSLTypes.F32;

    switch (node.kind) {
      case "Sin":
      case "Cos":
      case "Tan":
      case "Floor":
      case "Fract":
      case "Abs":
      case "Sqrt":
        expression = this.compileSingleInput(node, context);
        break;

      case "Pow":
      case "Min":
      case "Max":
      case "Mod":
        expression = this.compileTwoInput(node, context);
        break;

      case "Clamp":
      case "Smoothstep":
        expression = this.compileThreeInput(node, context);
        break;

      case "Step":
        expression = this.compileStep(node, context);
        break;

      case "Sign":
        expression = this.compileSign(node, context);
        break;

      default:
        throw new Error(`Unsupported scalar math node: ${node.kind}`);
    }

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }

  compileSingleInput(node, context) {
    const input = context.getConnectedInput(node, 0, WGSLTypes.F32) || "0.0";
    const funcName = node.kind.toLowerCase();

    if (node.kind === "Sqrt") {
      return `sqrt(max(${input}, 0.0))`;
    }

    return `${funcName}(${input})`;
  }

  compileTwoInput(node, context) {
    const a = context.getConnectedInput(node, 0, WGSLTypes.F32) || "0.0";
    const b = context.getConnectedInput(node, 1, WGSLTypes.F32) || "1.0";

    switch (node.kind) {
      case "Pow":
        return `pow(${a}, ${b})`;
      case "Min":
        return `min(${a}, ${b})`;
      case "Max":
        return `max(${a}, ${b})`;
      case "Mod":
        return `${a} - ${b} * floor(${a} / max(${b}, 0.0001))`;
      default:
        return `${a}`;
    }
  }

  compileThreeInput(node, context) {
    const a = context.getConnectedInput(node, 0, WGSLTypes.F32) || "0.0";
    const b = context.getConnectedInput(node, 1, WGSLTypes.F32) || "1.0";
    const c = context.getConnectedInput(node, 2, WGSLTypes.F32) || "0.5";

    switch (node.kind) {
      case "Clamp":
        return `clamp(${c}, ${a}, ${b})`;
      case "Smoothstep":
        return `smoothstep(${a}, ${b}, ${c})`;
      default:
        return a;
    }
  }

  compileStep(node, context) {
    const edge = context.getConnectedInput(node, 0, WGSLTypes.F32) || "0.5";
    const x = context.getConnectedInput(node, 1, WGSLTypes.F32) || "0.0";
    return `step(${edge}, ${x})`;
  }

  compileSign(node, context) {
    const input = context.getConnectedInput(node, 0, WGSLTypes.F32) || "0.0";
    return `sign(${input})`;
  }
}

export class VectorMathCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = [
      "Add",
      "Subtract",
      "Multiply",
      "Divide",
      "Mix",
      "Saturate",
    ];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    let expression;
    let outputType = WGSLTypes.VEC3;

    switch (node.kind) {
      case "Add":
        expression = this.compileAdd(node, context);
        break;
      case "Subtract":
        expression = this.compileSubtract(node, context);
        break;
      case "Multiply":
        expression = this.compileMultiply(node, context);
        break;
      case "Divide":
        expression = this.compileDivide(node, context);
        break;
      case "Mix":
        expression = this.compileMix(node, context);
        break;
      case "Saturate":
        expression = this.compileSaturate(node, context);
        break;
      default:
        throw new Error(`Unsupported vector math node: ${node.kind}`);
    }

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }

  compileAdd(node, context) {
    const a =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    const b =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    return `(${a}) + (${b})`;
  }

  compileSubtract(node, context) {
    const a =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    const b =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    return `(${a}) - (${b})`;
  }

  compileMultiply(node, context) {
    const a =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) || "vec3<f32>(1.0)";
    const b =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) || "vec3<f32>(1.0)";
    return `(${a}) * (${b})`;
  }

  compileDivide(node, context) {
    const a =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) || "vec3<f32>(1.0)";
    const b =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) || "vec3<f32>(1.0)";
    return `(${a}) / max((${b}), vec3<f32>(0.0001))`;
  }

  compileMix(node, context) {
    const a =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    const b =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) || "vec3<f32>(1.0)";
    const t = context.getConnectedInput(node, 2, WGSLTypes.F32) || "0.5";
    return `mix(${a}, ${b}, ${t})`;
  }

  compileSaturate(node, context) {
    const input =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    return `clamp(${input}, vec3<f32>(0.0), vec3<f32>(1.0))`;
  }
}

export class VectorOperationCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = [
      "Dot",
      "Cross",
      "Normalize",
      "Length",
      "Distance",
      "Reflect",
      "Refract",
    ];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    let expression;
    let outputType;

    switch (node.kind) {
      case "Dot":
      case "Length":
      case "Distance":
        outputType = WGSLTypes.F32;
        break;
      default:
        outputType = WGSLTypes.VEC3;
    }

    switch (node.kind) {
      case "Dot":
        expression = this.compileDot(node, context);
        break;
      case "Cross":
        expression = this.compileCross(node, context);
        break;
      case "Normalize":
        expression = this.compileNormalize(node, context);
        break;
      case "Length":
        expression = this.compileLength(node, context);
        break;
      case "Distance":
        expression = this.compileDistance(node, context);
        break;
      case "Reflect":
        expression = this.compileReflect(node, context);
        break;
      case "Refract":
        expression = this.compileRefract(node, context);
        break;
      default:
        throw new Error(`Unsupported vector operation: ${node.kind}`);
    }

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }

  compileDot(node, context) {
    const a =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) ||
      "vec3<f32>(1.0, 0.0, 0.0)";
    const b =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) ||
      "vec3<f32>(0.0, 1.0, 0.0)";
    return `dot(${a}, ${b})`;
  }

  compileCross(node, context) {
    const a =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) ||
      "vec3<f32>(1.0, 0.0, 0.0)";
    const b =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) ||
      "vec3<f32>(0.0, 1.0, 0.0)";
    return `cross(${a}, ${b})`;
  }

  compileNormalize(node, context) {
    const vec =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) ||
      "vec3<f32>(1.0, 0.0, 0.0)";
    return `normalize(${vec})`;
  }

  compileLength(node, context) {
    const vec =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    return `length(${vec})`;
  }

  compileDistance(node, context) {
    const a =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    const b =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) || "vec3<f32>(0.0)";
    return `distance(${a}, ${b})`;
  }

  compileReflect(node, context) {
    const incident =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) ||
      "vec3<f32>(1.0, -1.0, 0.0)";
    const normal =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) ||
      "vec3<f32>(0.0, 1.0, 0.0)";
    return `reflect(${incident}, ${normal})`;
  }

  compileRefract(node, context) {
    const incident =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) ||
      "vec3<f32>(1.0, -1.0, 0.0)";
    const normal =
      context.getConnectedInput(node, 1, WGSLTypes.VEC3) ||
      "vec3<f32>(0.0, 1.0, 0.0)";
    const eta = context.getConnectedInput(node, 2, WGSLTypes.F32) || "1.5";
    return `refract(${incident}, ${normal}, ${eta})`;
  }
}
