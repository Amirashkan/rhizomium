// src/codegen/generators/TextureBindings.js
export class TextureBindings {
  /**
   * Generate texture binding code for WGSL
   * @param {Object} graph
   * @returns {string} Texture binding declarations
   */
  static generate(graph) {
    let bindingCode = "";
    let bindingIndex = 3; // 0:u, 1:g, 2:ParamUniforms (if present)

    if (!graph.nodes) {
      return bindingCode;
    }

    for (const node of graph.nodes) {
      if (node.kind === "Texture2D") {
        const nodeId = this.sanitize(node.id);

        bindingCode += `
@group(0) @binding(${bindingIndex}) var texture_${nodeId}: texture_2d<f32>;
@group(0) @binding(${bindingIndex + 1}) var sampler_${nodeId}: sampler;`;
        bindingIndex += 2;
      } else if (node.kind === "TextureCube") {
        const nodeId = this.sanitize(node.id);
        bindingCode += `
@group(0) @binding(${bindingIndex}) var textureCube_${nodeId}: texture_cube<f32>;
@group(0) @binding(${bindingIndex + 1}) var samplerCube_${nodeId}: sampler;`;
        bindingIndex += 2;
      } else if (node.kind && node.kind.startsWith('Compute')) {
        // Compute nodes used in fragment shaders need texture bindings
        let nodeId = this.sanitize(node.id);
        // Remove node_ prefix if present (consistent with ComputeNodes.js)
        if (nodeId.startsWith('node_')) {
          nodeId = nodeId.substring(5);
        }

        bindingCode += `
@group(0) @binding(${bindingIndex}) var compute_node_${nodeId}: texture_2d<f32>;
@group(0) @binding(${bindingIndex + 1}) var sampler_compute_node_${nodeId}: sampler;`;
        bindingIndex += 2;
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
