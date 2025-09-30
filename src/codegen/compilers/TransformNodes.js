// src/codegen/compilers/TransformNodes.js - OPTIMIZED VERSION
// Key optimizations: GPU-side trigonometry, reduced calculations, batched transforms

export class TransformNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    return ['Transform2D', 'Scale2D', 'Rotate2D', 'Translate2D', 'TileAndOffset', 'Flip2D', 'UVToColor'].includes(kind);
  }

  /**
   * Compile transform nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput) {
    console.log(`🔧 TRANSFORM COMPILER CALLED: ${node.kind} (${node.id})`);
    
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'Transform2D':
        console.log(`🔧 Compiling Transform2D with params:`, node.params);
        return this.compileOptimizedTransform2D(node, getInput, nodeId);
      case 'Scale2D':
        return this.compileScale2D(node, getInput, nodeId);
      case 'Rotate2D':
        return this.compileOptimizedRotate2D(node, getInput, nodeId);
      case 'Translate2D':
        return this.compileTranslate2D(node, getInput, nodeId);
      case 'TileAndOffset':
        return this.compileTileAndOffset(node, getInput, nodeId);
      case 'Flip2D':
        return this.compileFlip2D(node, getInput, nodeId);
      case 'UVToColor':
        return this.compileUVToColor(node, getInput, nodeId);
      default:
        return null;
    }
  }

  /**
   * Get parameter value with proper type conversion and expression detection
   */
  getParam(node, name, defaultValue) {
    const value = node.params?.[name] ?? defaultValue;
    if (typeof value === 'boolean') return value;
    
    return value; // Return raw value, we'll handle expressions in shader generation
  }

  /**
   * OPTIMIZED: Check if a parameter is a time-based expression
   */
  isTimeExpression(value) {
    if (typeof value === 'string') {
      return value.includes('time') || value.startsWith('=');
    }
    return false;
  }

  /**
   * OPTIMIZED: Generate shader expression for parameter
   */
getShaderParam(node, name, defaultValue) {
  const value = this.getParam(node, name, defaultValue);
  
  if (typeof value === 'string' && value.startsWith('=')) {
    let expr = value.substring(1);
    expr = expr.replace(/time/g, 'u.time');
    expr = expr.replace(/sin\(/g, 'sin(');
    expr = expr.replace(/cos\(/g, 'cos(');
    expr = expr.replace(/\*/g, ' * ');
    return expr;
  }
  
  // Handle expressions without = prefix (like "time" or "time*10")
  if (typeof value === 'string' && /\btime\b/.test(value)) {
    let expr = value.replace(/time/g, 'u.time');
    return expr;
  }
  
  if (typeof value === 'number') {
    return value.toString();
  }
  
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue.toString() : parsed.toString();
}

  /**
   * OPTIMIZED: Compile full 2D transformation with GPU-side calculations
   */
  compileOptimizedTransform2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    console.log(`🔧 Transform2D input UV: ${uv}`);
    
    const translateX = this.getShaderParam(node, 'translateX', 0.0);
    const translateY = this.getShaderParam(node, 'translateY', 0.0);
    const scaleX = this.getShaderParam(node, 'scaleX', 1.0);
    const scaleY = this.getShaderParam(node, 'scaleY', 1.0);
    const rotation = this.getShaderParam(node, 'rotation', 0.0);
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);

    console.log(`🔧 Transform2D shader params:`, { translateX, translateY, scaleX, scaleY, rotation, centerX, centerY });

    // OPTIMIZATION: Check if rotation is static to avoid trig calculations
    const isStaticRotation = !this.isTimeExpression(node.params?.rotation);
    
    let line;
    if (isStaticRotation && parseFloat(rotation) === 0.0) {
      // FAST PATH: No rotation, just scale and translate
      line = `
  // Transform2D node_${nodeId} (optimized - no rotation)
  var uv_${nodeId} = ${uv};
  uv_${nodeId} = (uv_${nodeId} - vec2<f32>(${centerX}, ${centerY})) * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${centerX}, ${centerY});
  let node_${nodeId} = uv_${nodeId} + vec2<f32>(${translateX}, ${translateY});`;
    } else if (isStaticRotation) {
      // MEDIUM PATH: Static rotation, pre-calculate trig
      const cos_r = Math.cos(parseFloat(rotation));
      const sin_r = Math.sin(parseFloat(rotation));
      
      line = `
  // Transform2D node_${nodeId} (optimized - static rotation)
  var uv_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  uv_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * ${cos_r} - uv_${nodeId}.y * ${sin_r},
    uv_${nodeId}.x * ${sin_r} + uv_${nodeId}.y * ${cos_r}
  ) * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${centerX}, ${centerY});
  let node_${nodeId} = uv_${nodeId} + vec2<f32>(${translateX}, ${translateY});`;
    } else {
      // SLOW PATH: Dynamic rotation, calculate on GPU
      line = `
  // Transform2D node_${nodeId} (dynamic rotation)
  var uv_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let rot_${nodeId} = ${rotation};
  let cos_${nodeId} = cos(rot_${nodeId});
  let sin_${nodeId} = sin(rot_${nodeId});
  uv_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * cos_${nodeId} - uv_${nodeId}.y * sin_${nodeId},
    uv_${nodeId}.x * sin_${nodeId} + uv_${nodeId}.y * cos_${nodeId}
  ) * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${centerX}, ${centerY});
  let node_${nodeId} = uv_${nodeId} + vec2<f32>(${translateX}, ${translateY});`;
    }

    console.log(`🔧 Generated optimized shader line:`, line);
    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * OPTIMIZED: Compile 2D rotation with GPU-side calculations
   */
  compileOptimizedRotate2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const rotation = this.getShaderParam(node, 'rotation', 0.0);
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);

    // OPTIMIZATION: Check if rotation is static
    const isStaticRotation = !this.isTimeExpression(node.params?.rotation);
    
    let line;
    if (isStaticRotation && parseFloat(rotation) === 0.0) {
      // FAST PATH: No rotation
      line = `let node_${nodeId} = ${uv};`;
    } else if (isStaticRotation) {
      // MEDIUM PATH: Static rotation
      const cos_r = Math.cos(parseFloat(rotation));
      const sin_r = Math.sin(parseFloat(rotation));

      line = `
  // Rotate2D node_${nodeId} (static)
  var uv_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let node_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * ${cos_r} - uv_${nodeId}.y * ${sin_r},
    uv_${nodeId}.x * ${sin_r} + uv_${nodeId}.y * ${cos_r}
  ) + vec2<f32>(${centerX}, ${centerY});`;
    } else {
      // SLOW PATH: Dynamic rotation
      line = `
  // Rotate2D node_${nodeId} (dynamic)
  var uv_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let rot_${nodeId} = ${rotation};
  let cos_${nodeId} = cos(rot_${nodeId});
  let sin_${nodeId} = sin(rot_${nodeId});
  let node_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * cos_${nodeId} - uv_${nodeId}.y * sin_${nodeId},
    uv_${nodeId}.x * sin_${nodeId} + uv_${nodeId}.y * cos_${nodeId}
  ) + vec2<f32>(${centerX}, ${centerY});`;
    }

    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * OPTIMIZED: Compile 2D scale transformation
   */
  compileScale2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const scaleX = this.getShaderParam(node, 'scaleX', 1.0);
    const scaleY = this.getShaderParam(node, 'scaleY', 1.0);
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);

    // OPTIMIZATION: Check if it's just identity scaling
    if (scaleX === '1.0' && scaleY === '1.0') {
      return {
        line: `let node_${nodeId} = ${uv};`,
        outputType: "vec2"
      };
    }

    const line = `let node_${nodeId} = (${uv} - vec2<f32>(${centerX}, ${centerY})) * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${centerX}, ${centerY});`;

    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * Compile 2D translation transformation
   */
  compileTranslate2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const translateX = this.getShaderParam(node, 'translateX', 0.0);
    const translateY = this.getShaderParam(node, 'translateY', 0.0);

    // OPTIMIZATION: Check if it's no translation
    if (translateX === '0.0' && translateY === '0.0') {
      return {
        line: `let node_${nodeId} = ${uv};`,
        outputType: "vec2"
      };
    }

    const line = `let node_${nodeId} = ${uv} + vec2<f32>(${translateX}, ${translateY});`;

    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * OPTIMIZED: Compile tile and offset transformation
   */
  compileTileAndOffset(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const tilingX = this.getShaderParam(node, 'tilingX', 1.0);
    const tilingY = this.getShaderParam(node, 'tilingY', 1.0);
    const offsetX = this.getShaderParam(node, 'offsetX', 0.0);
    const offsetY = this.getShaderParam(node, 'offsetY', 0.0);

    // OPTIMIZATION: Check if it's identity transform
    if (tilingX === '1.0' && tilingY === '1.0' && offsetX === '0.0' && offsetY === '0.0') {
      return {
        line: `let node_${nodeId} = ${uv};`,
        outputType: "vec2"
      };
    }

    const line = `let node_${nodeId} = ${uv} * vec2<f32>(${tilingX}, ${tilingY}) + vec2<f32>(${offsetX}, ${offsetY});`;

    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * Compile UV to color conversion
   */
  compileUVToColor(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const line = `let node_${nodeId} = vec3<f32>(${uv}.x, ${uv}.y, 0.0);`;
    return {
      line,
      outputType: "vec3"
    };
  }

  /**
   * OPTIMIZED: Compile 2D flip transformation
   */
  compileFlip2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const flipX = this.getParam(node, 'flipX', false);
    const flipY = this.getParam(node, 'flipY', false);

    // OPTIMIZATION: Check if no flipping
    if (!flipX && !flipY) {
      return {
        line: `let node_${nodeId} = ${uv};`,
        outputType: "vec2"
      };
    }

    const scaleX = flipX ? -1.0 : 1.0;
    const scaleY = flipY ? -1.0 : 1.0;
    const offsetX = flipX ? 1.0 : 0.0;
    const offsetY = flipY ? 1.0 : 0.0;

    const line = `let node_${nodeId} = ${uv} * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${offsetX}, ${offsetY});`;

    return {
      line,
      outputType: "vec2"
    };
  }
}