// src/codegen/compilers/TextureNodes.js
// Texture nodes that *register global WGSL bindings* (group 0) and only emit sampling code in-line.

export class TextureNodes {
  constructor() {
    this.uniformManager = null;
  }

  setUniformManager(uniformManager) {
    this.uniformManager = uniformManager;
  }

  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind
   * @returns {boolean}
   */
  handles(kind) {
    return ["Texture2D", "TextureCube"].includes(kind);
  }

  compile(node, getInput) {
    // Make sure builder is present even if the caller forgot to pass it
    if (!this.builder && typeof window !== 'undefined' && window.wgslBuilder) {
      this.builder = window.wgslBuilder;
    }
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    switch (node.kind) {
      case "Texture2D":
        return this.compileTexture2D(node, getInput, nodeId);
      case "TextureCube":
        return this.compileTextureCube(node, getInput, nodeId);
      default:
        return null;
    }
  }

  compileTexture2D(node, getInput, nodeId) {
    this.uniformManager?.analyzeNode?.(node);

    // CRITICAL: Skip side effects during subgraph compilation (auto-bridging)
    // This prevents infinite loops where onParameterChange triggers renders
    // which trigger compute execution which triggers auto-bridging again
    const isSubgraphCompilation = window.nodeCompiler?.isSubgraphCompilation || false;
    if (!isSubgraphCompilation) {
      window.editor?.previewIntegration?.onParameterChange?.(node);
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
      { expression: `node_${nodeId}_rgba`, type: "vec4" },     // RGBA
      { expression: `node_${nodeId}_rgba.xyz`, type: "vec3" }, // RGB
      { expression: `vec3<f32>(node_${nodeId}_rgba.r, 0.0, 0.0)`, type: "vec3" }, // R colored
      { expression: `vec3<f32>(0.0, node_${nodeId}_rgba.g, 0.0)`, type: "vec3" }, // G colored
      { expression: `vec3<f32>(0.0, 0.0, node_${nodeId}_rgba.b)`, type: "vec3" }, // B colored
      { expression: `vec3<f32>(node_${nodeId}_rgba.a)`, type: "vec3" }, // A (grayscale)
    ];

    return { line, outputType: "vec4", outputPins };
  }

  compileTextureCube(node, getInput, nodeId) {
    const dir = getInput(0, "vec3", 
      "normalize(vec3<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0, 1.0))");
    const textureId = nodeId;
    
    const line = `let node_${nodeId}_rgba = textureSample(textureCube_${textureId}, samplerCube_${textureId}, ${dir});
    let node_${nodeId} = node_${nodeId}_rgba;`;
    
    console.log(`TextureCube line: ${line}`);
    
    // Define output pins for cube texture
    const outputPins = [
      { expression: `node_${nodeId}_rgba`, type: "vec4" },
      { expression: `node_${nodeId}_rgba.xyz`, type: "vec3" },
      { expression: `node_${nodeId}_rgba.a`, type: "f32" },
    ];

    return { line, outputType: "vec4", outputPins };
  }
}
