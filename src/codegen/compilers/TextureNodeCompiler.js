// src/codegen/compilers/TextureNodeCompiler.js
import { BaseNodeCompiler } from "./BaseNodeCompiler.js";
import { WGSLTypes, sanitizeId } from "../../core/TypeSystem.js";

export class TextureNodeCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = ["Texture2D", "TextureCube"];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    let expression;
    let outputType = WGSLTypes.VEC4;

    switch (node.kind) {
      case "Texture2D":
        expression = this.compileTexture2D(node, context);
        break;
      case "TextureCube":
        expression = this.compileTextureCube(node, context);
        break;
      default:
        throw new Error(`Unsupported texture node: ${node.kind}`);
    }

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }

  compileTexture2D(node, context) {
    const uv = context.getConnectedInput(node, 0, WGSLTypes.VEC2) || "in.uv";
    const textureId = sanitizeId(node.id);

    // Sample the texture - this returns a vec4 (RGBA)
    return `textureSample(texture_${textureId}, sampler_${textureId}, ${uv})`;
  }

  compileTextureCube(node, context) {
    const dir =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) ||
      "normalize(vec3<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0, 1.0))";
    const textureId = sanitizeId(node.id);

    return `textureSample(textureCube_${textureId}, samplerCube_${textureId}, ${dir})`;
  }
}

// src/codegen/compilers/FieldNodeCompiler.js
export class FieldNodeCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = ["CircleField"];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    let expression;
    let outputType = WGSLTypes.F32;

    switch (node.kind) {
      case "CircleField":
        expression = this.compileCircleField(node, context);
        break;
      default:
        throw new Error(`Unsupported field node: ${node.kind}`);
    }

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }

  compileCircleField(node, context) {
    // Use connected inputs if available, otherwise use node parameters, finally fallback to defaults
    const R =
      context.getConnectedInput(node, 0, WGSLTypes.F32) ||
      this.formatFloat(this.getParameterValue(node, "radius", 0.25));
    const E =
      context.getConnectedInput(node, 1, WGSLTypes.F32) ||
      this.formatFloat(this.getParameterValue(node, "epsilon", 0.02));

    return `1.0 - smoothstep((${R}) - max(${E}, 0.0001), (${R}) + max(${E}, 0.0001), distance(in.uv, vec2<f32>(0.5, 0.5)))`;
  }
}

// src/codegen/compilers/NoiseNodeCompiler.js
export class NoiseNodeCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = [
      "Random",
      "ValueNoise",
      "FBMNoise",
      "SimplexNoise",
      "VoronoiNoise",
      "RidgedNoise",
      "WarpNoise",
    ];
  }

  compile(node, context) {
    const nodeId = this.generateVariableName(node.id);
    let expression;
    let outputType = WGSLTypes.VEC3;

    switch (node.kind) {
      case "Random":
        expression = this.compileRandom(node, context);
        break;
      case "ValueNoise":
        expression = this.compileValueNoise(node, context);
        break;
      case "FBMNoise":
        expression = this.compileFBMNoise(node, context);
        break;
      case "SimplexNoise":
        expression = this.compileSimplexNoise(node, context);
        break;
      case "VoronoiNoise":
        expression = this.compileVoronoiNoise(node, context);
        break;
      case "RidgedNoise":
        expression = this.compileRidgedNoise(node, context);
        break;
      case "WarpNoise":
        expression = this.compileWarpNoise(node, context);
        break;
      default:
        throw new Error(`Unsupported noise node: ${node.kind}`);
    }

    const code = `let ${nodeId} = ${expression};`;
    context.setResult(node.id, nodeId, outputType);
    return code;
  }

  compileRandom(node, context) {
    const uv = context.getConnectedInput(node, 0, WGSLTypes.VEC2) || "in.uv";
    const seed = this.formatFloat(this.getParameterValue(node, "seed", 1.0));
    const scale = this.formatFloat(this.getParameterValue(node, "scale", 1.0));

    return `vec3<f32>(random(${uv} * ${scale} + vec2<f32>(${seed})))`;
  }

  compileValueNoise(node, context) {
    const uv = context.getConnectedInput(node, 0, WGSLTypes.VEC2) || "in.uv";
    const scale = this.formatFloat(this.getParameterValue(node, "scale", 5.0));
    const amplitude = this.formatFloat(
      this.getParameterValue(node, "amplitude", 1.0),
    );
    const offset = this.formatFloat(
      this.getParameterValue(node, "offset", 0.0),
    );
    const power = this.formatFloat(this.getParameterValue(node, "power", 1.0));

    return `vec3<f32>(clamp(pow(valueNoise(${uv} * ${scale}) * ${amplitude} + ${offset}, ${power}), 0.0, 1.0))`;
  }

  compileFBMNoise(node, context) {
    const uv = context.getConnectedInput(node, 0, WGSLTypes.VEC2) || "in.uv";
    const scale = this.formatFloat(this.getParameterValue(node, "scale", 3.0));
    const octaves = Math.floor(this.getParameterValue(node, "octaves", 4));
    const persistence = this.formatFloat(
      this.getParameterValue(node, "persistence", 0.5),
    );
    const lacunarity = this.formatFloat(
      this.getParameterValue(node, "lacunarity", 2.0),
    );
    const amplitude = this.formatFloat(
      this.getParameterValue(node, "amplitude", 1.0),
    );
    const offset = this.formatFloat(
      this.getParameterValue(node, "offset", 0.0),
    );
    const gain = this.formatFloat(this.getParameterValue(node, "gain", 0.5));
    const warp = this.formatFloat(this.getParameterValue(node, "warp", 0.0));

    let uvExpr = `${uv} * ${scale}`;
    if (parseFloat(warp) > 0.001) {
      uvExpr = `${uvExpr} + vec2<f32>(valueNoise(${uv} * ${this.formatFloat(parseFloat(scale) * 2.0)}) * ${warp})`;
    }

    return `vec3<f32>(clamp((fbm(${uvExpr}, ${octaves}, ${persistence}, ${lacunarity}) * ${amplitude} + ${offset}) * ${gain}, 0.0, 1.0))`;
  }

  compileSimplexNoise(node, context) {
    const uv = context.getConnectedInput(node, 0, WGSLTypes.VEC2) || "in.uv";
    const scale = this.formatFloat(this.getParameterValue(node, "scale", 4.0));
    const amplitude = this.formatFloat(
      this.getParameterValue(node, "amplitude", 1.0),
    );
    const offset = this.formatFloat(
      this.getParameterValue(node, "offset", 0.0),
    );
    const ridge = this.getParameterValue(node, "ridge", false);
    const turbulence = this.getParameterValue(node, "turbulence", false);

    let noiseExpr = `simplexNoise(${uv} * ${scale})`;
    if (ridge) {
      noiseExpr = `abs(${noiseExpr})`;
    }
    if (turbulence) {
      noiseExpr = `abs(${noiseExpr})`;
    }

    return `vec3<f32>(clamp(${noiseExpr} * ${amplitude} + ${offset}, 0.0, 1.0))`;
  }

  compileVoronoiNoise(node, context) {
    const uv = context.getConnectedInput(node, 0, WGSLTypes.VEC2) || "in.uv";
    const scale = this.formatFloat(this.getParameterValue(node, "scale", 8.0));
    const randomness = this.formatFloat(
      this.getParameterValue(node, "randomness", 1.0),
    );
    const smoothness = this.formatFloat(
      this.getParameterValue(node, "smoothness", 0.0),
    );
    const outputType = Math.floor(
      this.getParameterValue(node, "outputType", 0),
    );

    let voronoiExpr = `voronoi(${uv} * ${scale}, ${randomness})`;
    if (outputType === 1) {
      voronoiExpr = `${voronoiExpr}.y`;
    } else {
      voronoiExpr = `${voronoiExpr}.x`;
    }

    if (parseFloat(smoothness) > 0.001) {
      voronoiExpr = `smoothstep(0.0, ${smoothness}, ${voronoiExpr})`;
    }

    return `vec3<f32>(clamp(${voronoiExpr}, 0.0, 1.0))`;
  }

  compileRidgedNoise(node, context) {
    const uv = context.getConnectedInput(node, 0, WGSLTypes.VEC2) || "in.uv";
    const scale = this.formatFloat(this.getParameterValue(node, "scale", 4.0));
    const octaves = Math.floor(this.getParameterValue(node, "octaves", 6));
    const lacunarity = this.formatFloat(
      this.getParameterValue(node, "lacunarity", 2.0),
    );
    const gain = this.formatFloat(this.getParameterValue(node, "gain", 0.5));
    const amplitude = this.formatFloat(
      this.getParameterValue(node, "amplitude", 1.0),
    );
    const offset = this.formatFloat(
      this.getParameterValue(node, "offset", 1.0),
    );
    const threshold = this.formatFloat(
      this.getParameterValue(node, "threshold", 0.0),
    );

    return `vec3<f32>(clamp(ridgedNoise(${uv} * ${scale}, ${octaves}, ${lacunarity}, ${gain}, ${offset}, ${threshold}) * ${amplitude}, 0.0, 1.0))`;
  }

  compileWarpNoise(node, context) {
    const uv = context.getConnectedInput(node, 0, WGSLTypes.VEC2) || "in.uv";
    const scale = this.formatFloat(this.getParameterValue(node, "scale", 3.0));
    const warpScale = this.formatFloat(
      this.getParameterValue(node, "warpScale", 2.0),
    );
    const warpStrength = this.formatFloat(
      this.getParameterValue(node, "warpStrength", 0.1),
    );
    const octaves = Math.floor(this.getParameterValue(node, "octaves", 3));
    const amplitude = this.formatFloat(
      this.getParameterValue(node, "amplitude", 1.0),
    );

    return `vec3<f32>(clamp(warpedNoise(${uv}, ${scale}, ${warpScale}, ${warpStrength}, ${octaves}) * ${amplitude}, 0.0, 1.0))`;
  }
}

// src/codegen/compilers/OutputNodeCompiler.js
export class OutputNodeCompiler extends BaseNodeCompiler {
  constructor() {
    super();
    this.supportedNodes = ["OutputFinal"];
  }

  compile(node, context) {
    const c =
      context.getConnectedInput(node, 0, WGSLTypes.VEC3) ||
      "vec3<f32>(0.0,0.0,0.0)";
    const code = `finalColor = ${c};`;

    // Output nodes don't need to store results
    return code;
  }
}
