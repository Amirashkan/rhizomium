// src/codegen/compilers/NoiseNodes.js
export class NoiseNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    const noiseNodes = [
      'Random', 'ValueNoise', 'FBMNoise', 'SimplexNoise', 
      'VoronoiNoise', 'RidgedNoise', 'WarpNoise'
    ];
    return noiseNodes.includes(kind);
  }
  
  /**
   * Compile noise nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'Random':
        return this.compileRandom(node, getInput, nodeId);
      case 'ValueNoise':
        return this.compileValueNoise(node, getInput, nodeId);
      case 'FBMNoise':
        return this.compileFBMNoise(node, getInput, nodeId);
      case 'SimplexNoise':
        return this.compileSimplexNoise(node, getInput, nodeId);
      case 'VoronoiNoise':
        return this.compileVoronoiNoise(node, getInput, nodeId);
      case 'RidgedNoise':
        return this.compileRidgedNoise(node, getInput, nodeId);
      case 'WarpNoise':
        return this.compileWarpNoise(node, getInput, nodeId);
      default:
        return null;
    }
  }
  
  /**
   * Compile random noise
   */
  compileRandom(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const seed = node.props?.seed ?? 1.0;
    const scale = node.props?.scale ?? 1.0;
    
    return {
      line: `let node_${nodeId} = vec3<f32>(random(${uv} * ${scale.toFixed(3)} + vec2<f32>(${seed.toFixed(3)})));`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile value noise
   */
  compileValueNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = node.props?.scale ?? 5.0;
    const amplitude = node.props?.amplitude ?? 1.0;
    const offset = node.props?.offset ?? 0.0;
    const power = node.props?.power ?? 1.0;
    
    return {
      line: `let node_${nodeId} = vec3<f32>(clamp(pow(valueNoise(${uv} * ${scale.toFixed(3)}) * ${amplitude.toFixed(3)} + ${offset.toFixed(3)}, ${power.toFixed(3)}), 0.0, 1.0));`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile FBM noise
   */
  compileFBMNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = node.props?.scale ?? 3.0;
    const octaves = node.props?.octaves ?? 4;
    const persistence = node.props?.persistence ?? 0.5;
    const lacunarity = node.props?.lacunarity ?? 2.0;
    const amplitude = node.props?.amplitude ?? 1.0;
    const offset = node.props?.offset ?? 0.0;
    const gain = node.props?.gain ?? 0.5;
    const warp = node.props?.warp ?? 0.0;
    
    let uvExpr = `${uv} * ${scale.toFixed(3)}`;
    if (warp > 0.001) {
      uvExpr = `${uvExpr} + vec2<f32>(valueNoise(${uv} * ${(scale * 2.0).toFixed(3)}) * ${warp.toFixed(3)})`;
    }
    
    return {
      line: `let node_${nodeId} = vec3<f32>(clamp((fbm(${uvExpr}, ${octaves}, ${persistence.toFixed(3)}, ${lacunarity.toFixed(3)}) * ${amplitude.toFixed(3)} + ${offset.toFixed(3)}) * ${gain.toFixed(3)}, 0.0, 1.0));`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile simplex noise
   */
  compileSimplexNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = node.props?.scale ?? 4.0;
    const amplitude = node.props?.amplitude ?? 1.0;
    const offset = node.props?.offset ?? 0.0;
    const ridge = node.props?.ridge ?? false;
    const turbulence = node.props?.turbulence ?? false;
    
    let noiseExpr = `simplexNoise(${uv} * ${scale.toFixed(3)})`;
    if (ridge) {
      noiseExpr = `abs(${noiseExpr})`;
    }
    if (turbulence) {
      noiseExpr = `abs(${noiseExpr})`;
    }
    
    return {
      line: `let node_${nodeId} = vec3<f32>(clamp(${noiseExpr} * ${amplitude.toFixed(3)} + ${offset.toFixed(3)}, 0.0, 1.0));`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile voronoi noise
   */
  compileVoronoiNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = node.props?.scale ?? 8.0;
    const randomness = node.props?.randomness ?? 1.0;
    const smoothness = node.props?.smoothness ?? 0.0;
    const outputType = node.props?.outputType ?? 0;
    
    let voronoiExpr = `voronoi(${uv} * ${scale.toFixed(3)}, ${randomness.toFixed(3)})`;
    if (outputType === 1) {
      voronoiExpr = `${voronoiExpr}.y`;
    } else {
      voronoiExpr = `${voronoiExpr}.x`;
    }
    if (smoothness > 0.001) {
      voronoiExpr = `smoothstep(0.0, ${smoothness.toFixed(3)}, ${voronoiExpr})`;
    }
    
    return {
      line: `let node_${nodeId} = vec3<f32>(clamp(${voronoiExpr}, 0.0, 1.0));`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile ridged noise
   */
  compileRidgedNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = node.props?.scale ?? 4.0;
    const octaves = node.props?.octaves ?? 6;
    const lacunarity = node.props?.lacunarity ?? 2.0;
    const gain = node.props?.gain ?? 0.5;
    const amplitude = node.props?.amplitude ?? 1.0;
    const offset = node.props?.offset ?? 1.0;
    const threshold = node.props?.threshold ?? 0.0;
    
    return {
      line: `let node_${nodeId} = vec3<f32>(clamp(ridgedNoise(${uv} * ${scale.toFixed(3)}, ${octaves}, ${lacunarity.toFixed(3)}, ${gain.toFixed(3)}, ${offset.toFixed(3)}, ${threshold.toFixed(3)}) * ${amplitude.toFixed(3)}, 0.0, 1.0));`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile warp noise
   */
  compileWarpNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = node.props?.scale ?? 3.0;
    const warpScale = node.props?.warpScale ?? 2.0;
    const warpStrength = node.props?.warpStrength ?? 0.1;
    const octaves = node.props?.octaves ?? 3;
    const amplitude = node.props?.amplitude ?? 1.0;
    
    return {
      line: `let node_${nodeId} = vec3<f32>(clamp(warpedNoise(${uv}, ${scale.toFixed(3)}, ${warpScale.toFixed(3)}, ${warpStrength.toFixed(3)}, ${octaves}) * ${amplitude.toFixed(3)}, 0.0, 1.0));`,
      outputType: "vec3"
    };
  }
}