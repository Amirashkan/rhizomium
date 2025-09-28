// src/codegen/compilers/TransformNodes.js

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
      return this.compileTransform2D(node, getInput, nodeId);
      case 'Scale2D':
        return this.compileScale2D(node, getInput, nodeId);
      case 'Rotate2D':
        return this.compileRotate2D(node, getInput, nodeId);
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
   * Get parameter value with proper type conversion
   */
getParam(node, name, defaultValue) {
  const value = node.params?.[name] ?? defaultValue;
  if (typeof value === 'boolean') return value;
  
  // Check if it's an expression and evaluate it
  if (typeof value === 'string' && value.startsWith('=')) {
    try {
        if (this.isIncompleteExpression(value.slice(1))) {
        return defaultValue;}
      // Use the global expression system
      if (window.editor?.paramPanel?.expressionSystem) {
        return window.editor.paramPanel.expressionSystem.evaluateExpression(value, {}, node);
      }
    } catch (error) {
      console.warn(`Expression evaluation failed for ${name}:`, error);
    }
  }
  
  return parseFloat(value) || defaultValue;
}

  /**
   * Compile full 2D transformation matrix
   */
compileTransform2D(node, getInput, nodeId) {
  const uv = getInput(0, "vec2", "in.uv");
  console.log(`🔧 Transform2D input UV: ${uv}`);
  
  const translateX = this.getParam(node, 'translateX', 0.0);
  const translateY = this.getParam(node, 'translateY', 0.0);
    const scaleX = this.getParam(node, 'scaleX', 1.0);
    const scaleY = this.getParam(node, 'scaleY', 1.0);
    const rotation = this.getParam(node, 'rotation', 0.0);
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);

    const cos_r = Math.cos(rotation);
    const sin_r = Math.sin(rotation);
  console.log(`🔧 Transform2D params:`, { translateX, translateY, scaleX, scaleY, rotation, centerX, centerY });

    const line = `
  // Transform2D node_${nodeId}
  var uv_${nodeId} = ${uv};
  uv_${nodeId} = uv_${nodeId} - vec2<f32>(${centerX}, ${centerY}); // Center
  uv_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * ${cos_r} - uv_${nodeId}.y * ${sin_r},
    uv_${nodeId}.x * ${sin_r} + uv_${nodeId}.y * ${cos_r}
  ); // Rotate
  uv_${nodeId} = uv_${nodeId} * vec2<f32>(${scaleX}, ${scaleY}); // Scale
  uv_${nodeId} = uv_${nodeId} + vec2<f32>(${centerX}, ${centerY}); // Uncenter
  let node_${nodeId} = uv_${nodeId} + vec2<f32>(${translateX}, ${translateY}); // Translate`;
console.log(`🔧 Generated shader line:`, line);
    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * Compile 2D scale transformation
   */
  compileScale2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const scaleX = this.getParam(node, 'scaleX', 1.0);
    const scaleY = this.getParam(node, 'scaleY', 1.0);
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);

    const line = `
  // Scale2D node_${nodeId}
  var uv_${nodeId} = ${uv};
  uv_${nodeId} = uv_${nodeId} - vec2<f32>(${centerX}, ${centerY});
  uv_${nodeId} = uv_${nodeId} * vec2<f32>(${scaleX}, ${scaleY});
  let node_${nodeId} = uv_${nodeId} + vec2<f32>(${centerX}, ${centerY});`;

    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * Compile 2D rotation transformation
   */
  compileRotate2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const rotation = this.getParam(node, 'rotation', 0.0);
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);

    const cos_r = Math.cos(rotation);
    const sin_r = Math.sin(rotation);

    const line = `
  // Rotate2D node_${nodeId}
  var uv_${nodeId} = ${uv};
  uv_${nodeId} = uv_${nodeId} - vec2<f32>(${centerX}, ${centerY});
  uv_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * ${cos_r} - uv_${nodeId}.y * ${sin_r},
    uv_${nodeId}.x * ${sin_r} + uv_${nodeId}.y * ${cos_r}
  );
  let node_${nodeId} = uv_${nodeId} + vec2<f32>(${centerX}, ${centerY});`;

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
    
    const translateX = this.getParam(node, 'translateX', 0.0);
    const translateY = this.getParam(node, 'translateY', 0.0);

    const line = `let node_${nodeId} = ${uv} + vec2<f32>(${translateX}, ${translateY});`;

    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * Compile tile and offset transformation (common in graphics tools)
   */
  compileTileAndOffset(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const tilingX = this.getParam(node, 'tilingX', 1.0);
    const tilingY = this.getParam(node, 'tilingY', 1.0);
    const offsetX = this.getParam(node, 'offsetX', 0.0);
    const offsetY = this.getParam(node, 'offsetY', 0.0);

    const line = `let node_${nodeId} = ${uv} * vec2<f32>(${tilingX}, ${tilingY}) + vec2<f32>(${offsetX}, ${offsetY});`;

    return {
      line,
      outputType: "vec2"
    };
  }


compileUVToColor(node, getInput, nodeId) {
  const uv = getInput(0, "vec2", "in.uv");
  const line = `let node_${nodeId} = vec3<f32>(${uv}.x, ${uv}.y, 0.0);`;
  return {
    line,
    outputType: "vec3"
  };
}
  /**
   * Compile 2D flip transformation
   */
  compileFlip2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const flipX = this.getParam(node, 'flipX', false);
    const flipY = this.getParam(node, 'flipY', false);

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