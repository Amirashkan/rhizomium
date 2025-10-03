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
   * @returns {Object} { line, outputType }
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
   * Compile 2D texture sampling
   * Fixed to flip Y coordinate to handle upside-down textures
   */
  compileTexture2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const textureId = nodeId;
    
    // Flip the Y coordinate to fix upside-down texture
    // This creates a temporary variable with inverted Y
    const line = `let uv_${nodeId} = vec2<f32>(${uv}.x, 1.0 - ${uv}.y);
    let node_${nodeId} = textureSample(texture_${textureId}, sampler_${textureId}, uv_${nodeId});`;
    
    console.log(`Texture2D line: ${line}`);
    
    return {
      line,
      outputType: "vec4"
    };
  }
  
  /**
   * Compile cube texture sampling
   */
  compileTextureCube(node, getInput, nodeId) {
    const dir = getInput(0, "vec3", 
      "normalize(vec3<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0, 1.0))");
    const textureId = nodeId;
    
    const line = `let node_${nodeId} = textureSample(textureCube_${textureId}, samplerCube_${textureId}, ${dir});`;
    console.log(`TextureCube line: ${line}`);
    
    return {
      line,
      outputType: "vec4"
    };
  }
}