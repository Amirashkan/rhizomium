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

    // Create a Set of used node IDs for fast lookup
    const usedNodeIds = usedNodes ? new Set(usedNodes.map(n => n.id)) : null;
    
    // Also collect compute node IDs from computeNodeRegistry that are referenced
    const computeNodeIdsInUse = new Set();
    if (window.computeNodeRegistry && window.computeNodeRegistry.size > 0) {
      // Check if any compute nodes from registry are in the dependency chain
      for (const [nodeId] of window.computeNodeRegistry) {
        if (usedNodeIds && usedNodeIds.has(nodeId)) {
          computeNodeIdsInUse.add(nodeId);
        } else if (!usedNodeIds) {
          // If no filter, include all compute nodes (for backwards compatibility)
          computeNodeIdsInUse.add(nodeId);
        }
      }
    }

    // A ProjectionMap surface samples its source at a warped coordinate, which only
    // a texture can answer, so ComputeExecutor bridges each pin's source through
    // the fragment renderer and publishes it in nodeOutputs under the source's id
    // (see _projectionMapFragmentSources). That is the same place a compute
    // node's output lives, so these bind under the same compute_node_<id> name -
    // the renderer resolves both by name and cannot tell them apart.
    const bridgedIds = new Set();
    for (const node of nodesToProcess) {
      if (!node || node.kind !== 'ProjectionMap' || !Array.isArray(node.inputs)) continue;
      for (const sourceId of node.inputs) {
        if (sourceId === null || sourceId === undefined) continue;
        const sourceNode = (graph.nodes || []).find(n => String(n.id) === String(sourceId));
        // Nodes that already bind a texture of their own keep their own binding.
        if (!sourceNode) continue;
        if (sourceNode.kind === 'Texture2D' || sourceNode.kind === 'Text'
            || sourceNode.kind === 'TextureCube'
            || (sourceNode.kind && sourceNode.kind.startsWith('Compute'))) continue;
        bridgedIds.add(sourceId);
      }
    }

    if (nodesToProcess.length === 0 && computeNodeIdsInUse.size === 0 && bridgedIds.size === 0) {
      return bindingCode;
    }

    // Process regular graph nodes
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

      // Text rasterises its own bitmap into TextureManager under its node id (see
      // src/core/TextRasterizer.js), so it binds exactly like a sampled image.
      if (node.kind === "Texture2D" || node.kind === "Text") {
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
        computeNodeIdsInUse.delete(node.id); // Mark as processed
      }
    }
    
    // Process compute nodes from registry that weren't in the graph nodes
    for (const nodeId of computeNodeIdsInUse) {
      // Check if we've reached the texture limit
      if (textureCount >= MAX_TEXTURES) {
        console.warn(`[TextureBindings] Warning: Reached maximum texture limit (${MAX_TEXTURES}). Skipping additional compute textures.`);
        break;
      }
      
      let sanitizedId = this.sanitize(nodeId);
      // Remove node_ prefix if present (consistent with ComputeNodes.js)
      if (sanitizedId.startsWith('node_')) {
        sanitizedId = sanitizedId.substring(5);
      }

      bindingCode += `
@group(0) @binding(${bindingIndex}) var compute_node_${sanitizedId}: texture_2d<f32>;
@group(0) @binding(${bindingIndex + 1}) var sampler_compute_node_${sanitizedId}: sampler;`;
      bindingIndex += 2;
      textureCount += 1; // Each compute texture counts as 1 texture
    }

    // Fragment subgraphs bridged to textures for ProjectionMap surfaces.
    for (const nodeId of bridgedIds) {
      if (textureCount >= MAX_TEXTURES) {
        console.warn(`[TextureBindings] Warning: Reached maximum texture limit (${MAX_TEXTURES}). Skipping additional mapped surfaces.`);
        break;
      }

      let sanitizedId = this.sanitize(nodeId);
      if (sanitizedId.startsWith('node_')) {
        sanitizedId = sanitizedId.substring(5);
      }

      bindingCode += `
@group(0) @binding(${bindingIndex}) var compute_node_${sanitizedId}: texture_2d<f32>;
@group(0) @binding(${bindingIndex + 1}) var sampler_compute_node_${sanitizedId}: sampler;`;
      bindingIndex += 2;
      textureCount += 1;
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
