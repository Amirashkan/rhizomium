// src/codegen/generators/TextureBindings.js
export class TextureBindings {
  /**
   * Generate texture binding code for WGSL
   * @param {Object} graph - The node graph (or can be an array of nodes for filtered generation)
   * @param {Array} usedNodes - Optional: array of nodes to include (if provided, only these nodes get bindings)
   * @returns {string} Texture binding declarations
   */
  static generate(graph, usedNodes = null) {
    let bindingCode = "";
    let bindingIndex = 3; // 0:u, 1:g, 2:ParamUniforms (if present)
    
    // WebGPU limit: maximum 16 sampled textures per stage
    const MAX_TEXTURES = 16;
    let textureCount = 0;

    // If usedNodes is provided, use that; otherwise use all graph nodes
    const nodesToProcess = usedNodes || (graph.nodes || []);

    if (nodesToProcess.length === 0) {
      return bindingCode;
    }

    // Create a Set of used node IDs for fast lookup
    const usedNodeIds = usedNodes ? new Set(usedNodes.map(n => n.id)) : null;

    for (const node of nodesToProcess) {
      // Skip this node if we have a filter and it's not in the used nodes
      if (usedNodeIds && !usedNodeIds.has(node.id)) {
        continue;
      }

      // Check if we've reached the texture limit
      if (textureCount >= MAX_TEXTURES) {
        console.warn(`[TextureBindings] Warning: Reached maximum texture limit (${MAX_TEXTURES}). Skipping additional textures.`);
        break;
      }

      if (node.kind === "Texture2D") {
        const nodeId = this.sanitize(node.id);

        bindingCode += `
@group(0) @binding(${bindingIndex}) var texture_${nodeId}: texture_2d<f32>;
@group(0) @binding(${bindingIndex + 1}) var sampler_${nodeId}: sampler;`;
        bindingIndex += 2;
        textureCount += 1; // Each texture2D counts as 1 texture
      } else if (node.kind === "TextureCube") {
        const nodeId = this.sanitize(node.id);
        bindingCode += `
@group(0) @binding(${bindingIndex}) var textureCube_${nodeId}: texture_cube<f32>;
@group(0) @binding(${bindingIndex + 1}) var samplerCube_${nodeId}: sampler;`;
        bindingIndex += 2;
        textureCount += 1; // Each textureCube counts as 1 texture
      } else if (node.kind && node.kind.startsWith('Compute')) {
        // CRITICAL: Only add compute bindings for nodes actually in the dependency chain
        // This prevents exceeding the 16-texture-per-stage limit with many unused compute nodes
        let nodeId = this.sanitize(node.id);
        // Remove node_ prefix if present (consistent with ComputeNodes.js)
        if (nodeId.startsWith('node_')) {
          nodeId = nodeId.substring(5);
        }

        bindingCode += `
@group(0) @binding(${bindingIndex}) var compute_node_${nodeId}: texture_2d<f32>;
@group(0) @binding(${bindingIndex + 1}) var sampler_compute_node_${nodeId}: sampler;`;
        bindingIndex += 2;
        textureCount += 1; // Each compute texture counts as 1 texture
      }
    }

    return bindingCode;
  }
  
  /**
   * Sanitize node ID for use in shader code
   * @param {string} id 
   * @returns {string}
   */
  static sanitize(id) {
    return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
  }
}
