// src/codegen/compilers/TextureNodes.js
export class TextureNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    return ['Texture2D', 'TextureCube'].includes(kind);
  }
  
  /**
   * Compile texture nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType, outputPins }
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'Texture2D':
        return this.compileTexture2D(node, getInput, nodeId);
      case 'TextureCube':
        return this.compileTextureCube(node, getInput, nodeId);
      default:
        return null;
    }
  }
  
  /**
   * Compile 2D texture sampling with multi-output support
   * Supports channel extraction via output pins:
   * Pin 0: RGBA (vec4)
   * Pin 1: RGB (vec3)
   * Pin 2: R (f32)
   * Pin 3: G (f32)
   * Pin 4: B (f32)
   * Pin 5: A (f32)
   */
  compileTexture2D(node, getInput, nodeId) {
      if (this.uniformManager) {
    this.uniformManager.analyzeNode(node);
  }

  if (window.editor?.previewIntegration) {
    window.editor.previewIntegration.onParameterChange(node);
  }
    const uv = getInput(0, "vec2", "in.uv");
    const textureId = nodeId;
    
    // Flip Y coordinate to fix upside-down texture
    // Sample once and store in a variable for channel extraction
    const line = `let uv_${nodeId} = vec2<f32>(${uv}.x, 1.0 - ${uv}.y);
    let node_${nodeId}_rgba = textureSample(texture_${textureId}, sampler_${textureId}, uv_${nodeId});
    let node_${nodeId} = node_${nodeId}_rgba;`;
    
    console.log(`Texture2D line: ${line}`);
    
    // Define all output pins with proper channel extraction
    // Options: Return vec3 colored channels or f32 grayscale
    const outputPins = [
      { expression: `node_${nodeId}_rgba`, type: "vec4" },                              // Pin 0: RGBA
      { expression: `node_${nodeId}_rgba.xyz`, type: "vec3" },                          // Pin 1: RGB
      { expression: `vec3<f32>(node_${nodeId}_rgba.r, 0.0, 0.0)`, type: "vec3" },      // Pin 2: R (red colored)
      { expression: `vec3<f32>(0.0, node_${nodeId}_rgba.g, 0.0)`, type: "vec3" },      // Pin 3: G (green colored)
      { expression: `vec3<f32>(0.0, 0.0, node_${nodeId}_rgba.b)`, type: "vec3" },      // Pin 4: B (blue colored)
      { expression: `vec3<f32>(node_${nodeId}_rgba.a)`, type: "vec3" }                 // Pin 5: A (grayscale)
    ];
    
    return {
      line,
      outputType: "vec4", // Default output type (for backward compatibility)
      outputPins: outputPins // Multi-output support
    };
  }
  
  /**
   * Compile cube texture sampling with multi-output support
   * Pin 0: RGBA (vec4)
   * Pin 1: RGB (vec3)
   * Pin 2: A (f32)
   */
  compileTextureCube(node, getInput, nodeId) {
    const dir = getInput(0, "vec3", 
      "normalize(vec3<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0, 1.0))");
    const textureId = nodeId;
    
    const line = `let node_${nodeId}_rgba = textureSample(textureCube_${textureId}, samplerCube_${textureId}, ${dir});
    let node_${nodeId} = node_${nodeId}_rgba;`;
    
    console.log(`TextureCube line: ${line}`);
    
    // Define output pins for cube texture
    const outputPins = [
      { expression: `node_${nodeId}_rgba`, type: "vec4" },      // Pin 0: RGBA
      { expression: `node_${nodeId}_rgba.xyz`, type: "vec3" },  // Pin 1: RGB
      { expression: `node_${nodeId}_rgba.a`, type: "f32" }      // Pin 2: A
    ];
    
    return {
      line,
      outputType: "vec4",
      outputPins: outputPins
    };
  }
}