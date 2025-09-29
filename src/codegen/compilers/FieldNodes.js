// src/codegen/compilers/FieldNodes.js
export class FieldNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    return [
      'LinearGradient', 'RadialGradient', 'AngularGradient', 'ConicGradient',
      'Checker', 'Stripe', 'Circle', 'Rectangle', 'Polygon',
      'Worley', 'CellNoise'
    ].includes(kind);
  }
  
  /**
   * Compile field nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType }
   */
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
      case 'Checker':
        return this.compileChecker(node, getInput, nodeId);
      case 'Stripe':
        return this.compileStripe(node, getInput, nodeId);
      case 'Circle':
        return this.compileCircle(node, getInput, nodeId);
      case 'Rectangle':
        return this.compileRectangle(node, getInput, nodeId);
      case 'Polygon':
        return this.compilePolygon(node, getInput, nodeId);
      case 'Worley':
        return this.compileWorley(node, getInput, nodeId);
      case 'CellNoise':
        return this.compileCellNoise(node, getInput, nodeId);
      default:
        return null;
    }
  }
  
  getParam(node, name, defaultValue) {
    return node.params?.[name] ?? defaultValue;
  }
  
  compileLinearGradient(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const angle = this.getParam(node, 'angle', 0.0);
    const offset = this.getParam(node, 'offset', 0.0);
    const scale = this.getParam(node, 'scale', 1.0);
    const repeat = this.getParam(node, 'repeat', false);
    
    const line = `
  let dir_${nodeId} = vec2<f32>(cos(${angle}), sin(${angle}));
  let proj_${nodeId} = dot(${uv} - vec2<f32>(0.5), dir_${nodeId}) * ${scale} + ${offset};
  let node_${nodeId} = ${repeat ? `fract(proj_${nodeId})` : `proj_${nodeId}`};`;
    
    return { line, outputType: "f32" };
  }
  
  compileRadialGradient(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const radius = this.getParam(node, 'radius', 0.5);
    const falloff = this.getParam(node, 'falloff', 1.0);
    const invert = this.getParam(node, 'invert', false);
    
    const dist = `pow(distance(${uv}, vec2<f32>(${centerX}, ${centerY})) / ${radius}, ${falloff})`;
    const value = invert ? `(1.0 - ${dist})` : dist;
    
    return {
      line: `let node_${nodeId} = clamp(${value}, 0.0, 1.0);`,
      outputType: "f32"
    };
  }
  
  compileAngularGradient(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const rotation = this.getParam(node, 'rotation', 0.0);
    const repeat = this.getParam(node, 'repeat', 1.0);
    
    const line = `
  let dir_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let angle_${nodeId} = atan2(dir_${nodeId}.y, dir_${nodeId}.x) + ${rotation};
  let node_${nodeId} = fract((angle_${nodeId} / 6.28318530718) * ${repeat});`;
    
    return { line, outputType: "f32" };
  }
  
  compileConicGradient(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const startAngle = this.getParam(node, 'startAngle', 0.0);
    const endAngle = this.getParam(node, 'endAngle', 6.28318);
    const smoothness = this.getParam(node, 'smoothness', 0.0);
    
    const line = `
  let dir_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let angle_${nodeId} = atan2(dir_${nodeId}.y, dir_${nodeId}.x);
  let t_${nodeId} = (angle_${nodeId} - ${startAngle}) / (${endAngle} - ${startAngle});
  let node_${nodeId} = ${smoothness > 0 ? `smoothstep(0.0, 1.0, clamp(t_${nodeId}, 0.0, 1.0))` : `clamp(t_${nodeId}, 0.0, 1.0)`};`;
    
    return { line, outputType: "f32" };
  }
  
  compileChecker(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scaleX = this.getParam(node, 'scaleX', 8.0);
    const scaleY = this.getParam(node, 'scaleY', 8.0);
    const smoothness = this.getParam(node, 'smoothness', 0.0);
    
    if (smoothness > 0) {
      const line = `
  let checker_uv_${nodeId} = ${uv} * vec2<f32>(${scaleX}, ${scaleY});
  let checker_smooth_${nodeId} = fract(checker_uv_${nodeId}) - 0.5;
  let checker_edge_${nodeId} = abs(checker_smooth_${nodeId}) / ${smoothness};
  let checker_pattern_${nodeId} = (floor(checker_uv_${nodeId}.x) + floor(checker_uv_${nodeId}.y)) % 2.0;
  let node_${nodeId} = mix(checker_pattern_${nodeId}, 1.0 - checker_pattern_${nodeId}, smoothstep(0.0, 1.0, min(checker_edge_${nodeId}.x, checker_edge_${nodeId}.y)));`;
      return { line, outputType: "f32" };
    }
    
    const line = `
  let checker_uv_${nodeId} = floor(${uv} * vec2<f32>(${scaleX}, ${scaleY}));
  let node_${nodeId} = (checker_uv_${nodeId}.x + checker_uv_${nodeId}.y) % 2.0;`;
    
    return { line, outputType: "f32" };
  }
  
  compileStripe(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const frequency = this.getParam(node, 'frequency', 5.0);
    const angle = this.getParam(node, 'angle', 0.0);
    const thickness = this.getParam(node, 'thickness', 0.5);
    const smoothness = this.getParam(node, 'smoothness', 0.0);
    
    const line = `
  let stripe_dir_${nodeId} = vec2<f32>(cos(${angle}), sin(${angle}));
  let stripe_coord_${nodeId} = dot(${uv}, stripe_dir_${nodeId}) * ${frequency};
  let stripe_pattern_${nodeId} = fract(stripe_coord_${nodeId});
  let node_${nodeId} = ${smoothness > 0 
    ? `smoothstep(${thickness} - ${smoothness}, ${thickness} + ${smoothness}, stripe_pattern_${nodeId})`
    : `step(${thickness}, stripe_pattern_${nodeId})`};`;
    
    return { line, outputType: "f32" };
  }
  
compileCircle(node, getInput, nodeId) {
  const uv = getInput(0, "vec2", "in.uv");  // This gets the ACTUAL connected input or defaults to in.uv
  const centerX = this.getParam(node, 'centerX', 0.5);
  const centerY = this.getParam(node, 'centerY', 0.5);
  const radius = this.getParam(node, 'radius', 0.25);
  const smoothness = this.getParam(node, 'smoothness', 0.01);
  const invert = this.getParam(node, 'invert', false);
  
  const dist = `distance(${uv}, vec2<f32>(${centerX}, ${centerY}))`; // Use uv variable here, not node_3
  const circle = `smoothstep(${radius} - ${smoothness}, ${radius} + ${smoothness}, ${dist})`;
  const value = invert ? `(1.0 - ${circle})` : circle;
  
  return {
    line: `let node_${nodeId} = ${value};`,
    outputType: "f32"
  };
}
  
  compileRectangle(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const width = this.getParam(node, 'width', 0.5);
    const height = this.getParam(node, 'height', 0.5);
    const roundness = this.getParam(node, 'roundness', 0.0);
    const smoothness = this.getParam(node, 'smoothness', 0.01);
    const invert = this.getParam(node, 'invert', false);
    
    const line = `
  let rect_p_${nodeId} = abs(${uv} - vec2<f32>(${centerX}, ${centerY})) - vec2<f32>(${width}, ${height}) * 0.5 + ${roundness};
  let rect_d_${nodeId} = length(max(rect_p_${nodeId}, vec2<f32>(0.0))) + min(max(rect_p_${nodeId}.x, rect_p_${nodeId}.y), 0.0) - ${roundness};
  let rect_sdf_${nodeId} = smoothstep(${smoothness}, -${smoothness}, rect_d_${nodeId});
  let node_${nodeId} = ${invert ? `(1.0 - rect_sdf_${nodeId})` : `rect_sdf_${nodeId}`};`;
    
    return { line, outputType: "f32" };
  }
  
  compilePolygon(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const sides = Math.max(3, Math.floor(this.getParam(node, 'sides', 6)));
    const radius = this.getParam(node, 'radius', 0.25);
    const rotation = this.getParam(node, 'rotation', 0.0);
    const smoothness = this.getParam(node, 'smoothness', 0.01);
    const invert = this.getParam(node, 'invert', false);
    
    const line = `
  let poly_p_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let poly_a_${nodeId} = atan2(poly_p_${nodeId}.y, poly_p_${nodeId}.x) + ${rotation};
  let poly_r_${nodeId} = length(poly_p_${nodeId});
  let poly_angle_${nodeId} = 6.28318530718 / f32(${sides});
  let poly_d_${nodeId} = poly_r_${nodeId} * cos(poly_angle_${nodeId} * 0.5) - ${radius} * cos(poly_angle_${nodeId} * 0.5 - (poly_a_${nodeId} % poly_angle_${nodeId}));
  let poly_sdf_${nodeId} = smoothstep(${smoothness}, -${smoothness}, poly_d_${nodeId});
  let node_${nodeId} = ${invert ? `(1.0 - poly_sdf_${nodeId})` : `poly_sdf_${nodeId}`};`;
    
    return { line, outputType: "f32" };
  }
  
  compileWorley(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.getParam(node, 'scale', 8.0);
    const jitter = this.getParam(node, 'jitter', 1.0);
    const distanceMetric = this.getParam(node, 'distanceMetric', 'euclidean');
    const minkowskiP = this.getParam(node, 'minkowskiP', 2.0);
    
    // This will need a worley noise function in the shader
    return {
      line: `let node_${nodeId} = worleyNoise(${uv} * ${scale}, ${jitter});`,
      outputType: "f32"
    };
  }
  
  compileCellNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.getParam(node, 'scale', 8.0);
    const randomness = this.getParam(node, 'randomness', 1.0);
    const smooth = this.getParam(node, 'smooth', false);
    
    return {
      line: `let node_${nodeId} = hash12(floor(${uv} * ${scale}));`,
      outputType: "f32"
    };
  }
}