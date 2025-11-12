// src/codegen/glslBuilder.js
import { GraphProcessor } from './processors/GraphProcessor.js';
import { TypeConverter } from './processors/TypeConverter.js';
import { NodeCompiler } from './processors/NodeCompiler.js';
import { TextureBindings } from './generators/TextureBindings.js';
import { generateShader } from './templates/ShaderTemplate.js';

/**
 * Main WGSL builder for Rhizomium
 * Compiles node graph into a valid WGSL shader source.
 * @param {Object} graph - The node graph to compile
 * @param {Object} options - Build options
 * @param {boolean} options.skipCacheClear - If true, don't clear global caches (for subgraph compilation)
 */
export function buildWGSL(graph, options = {}) {
  const processor = new GraphProcessor();

  // Shared NodeCompiler instance
  if (!window.nodeCompiler) {
    window.nodeCompiler = new NodeCompiler();
  }
  const compiler = window.nodeCompiler;

  // --- Clear all cached state before building (unless this is a subgraph build) ---
  if (!options.skipCacheClear) {
    compiler.uniformManager.clear();

    processor.clearFunctionCollection();

    if (compiler.compilers.field && compiler.compilers.field.clearFunctionCache) {
      compiler.compilers.field.clearFunctionCache();

    }

    if (compiler.compilers.transform && compiler.compilers.transform.clearHelperCache) {
      compiler.compilers.transform.clearHelperCache();
    }
  }

  // Set the compilation mode on the compiler so child compilers can avoid side effects
  compiler.isSubgraphCompilation = options.skipCacheClear || false;

  // --- Process the graph ---
  const result = processor.processGraph(graph);
  const { orderedNodes, outputNode } = result;


  if (orderedNodes.length > 0) {
  }

  if (!outputNode || orderedNodes.length === 0) {

    compiler.isSubgraphCompilation = false;
    return { wgsl: '', uniformManager: compiler.uniformManager };
  }

  // --- Compile all nodes into WGSL lines ---
  const compiledData = compiler.compileNodes(orderedNodes);

  // Reset the flag after compilation
  compiler.isSubgraphCompilation = false;
  const { lines, uniformStruct, uniformManager, usesNoise } = compiledData;

  // --- Collect all function definitions and helpers ---
  const shapeFunctions = compiler.compilers.field?.getAllFunctionDefinitions
    ? compiler.compilers.field.getAllFunctionDefinitions()
    : '';

  const transformHelpers = compiler.compilers.transform?.getHelperFunctions
    ? compiler.compilers.transform.getHelperFunctions()
    : '';

  const noiseHelpers = usesNoise && compiler.compilers.noise?.getHelperFunctions
    ? compiler.compilers.noise.getHelperFunctions()
    : '';

  const colorHelpers = compiler.compilers.utility?.getHelperFunctions
    ? compiler.compilers.utility.getHelperFunctions()
    : '';

  // CRITICAL: Only generate bindings for nodes in the dependency chain
  // This prevents exceeding the 16-texture-per-stage limit when there are many unused nodes
  const textureBindings = TextureBindings.generate(graph, orderedNodes);

  // Add compute shader texture bindings if compute nodes exist
  // CRITICAL: Only add bindings for compute nodes in the dependency chain (orderedNodes)
  // to avoid exceeding WebGPU's 16-texture-per-stage limit
  let computeBindings = '';
  if (window.computeNodeRegistry && window.computeNodeRegistry.size > 0) {
    // Create a Set of node IDs in the dependency chain for fast lookup
    const orderedNodeIds = new Set(orderedNodes.map(n => n.id));

    computeBindings = '\n// Compute Shader Texture Bindings\n';
    let bindingIndex = 100;

    for (const [nodeId, nodeData] of window.computeNodeRegistry) {
      // Only add bindings for compute nodes that are in the dependency chain
      if (!orderedNodeIds.has(nodeId)) {
        continue; // Skip nodes not in the output chain
      }

      const sanitizedId = nodeId.replace(/[^a-zA-Z0-9_]/g, "_");
      const textureName = `compute_${sanitizedId}`;
      const samplerName = `sampler_compute_${sanitizedId}`;

      computeBindings += `@group(0) @binding(${bindingIndex++}) var ${textureName}: texture_2d<f32>;\n`;
      computeBindings += `@group(0) @binding(${bindingIndex++}) var ${samplerName}: sampler;\n`;
    }
  }

  // --- Build the final shader using the WGSL template ---
  const wgsl = generateShader(
    {
      lines,
      uniformStruct,
      shapeFunctions,
      transformHelpers,
      noiseHelpers,
      colorHelpers,
      computeBindings,
    },
    textureBindings
  );

  return {
    wgsl,
    uniformManager,
  };
}
