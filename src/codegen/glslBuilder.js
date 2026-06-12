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

  // For subgraph builds (fragment→compute auto-bridging, live streaming) the
  // shared uniform manager must not be disturbed: gpuRenderer sizes and writes
  // its u_params buffer from this manager every frame, so letting a subgraph
  // compile clear/repopulate it desynchronizes the buffer size from the write
  // size ("Write range does not fit in ubuf:u_params" + preview flicker).
  // Save the main graph's uniform state now, restore it after compiling, and
  // hand the caller a detached snapshot of the subgraph's own uniforms.
  let savedUniformState = null;
  if (options.skipCacheClear) {
    const um = compiler.uniformManager;
    savedUniformState = {
      uniformParameters: new Map(um.uniformParameters),
      uniformValues: new Map(um.uniformValues),
      dynamicParams: new Set(um.dynamicParams),
    };
  }

  const finishUniformState = () => {
    if (!savedUniformState) {
      return compiler.uniformManager;
    }
    const um = compiler.uniformManager;
    const subgraphUniforms = { uniformValues: new Map(um.uniformValues) };
    um.uniformParameters = savedUniformState.uniformParameters;
    um.uniformValues = savedUniformState.uniformValues;
    um.dynamicParams = savedUniformState.dynamicParams;
    return subgraphUniforms;
  };

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
    return { wgsl: '', uniformManager: finishUniformState() };
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
  // TextureBindings.generate() already handles both regular textures and compute node textures
  const textureBindings = TextureBindings.generate(graph, orderedNodes);

  // --- Build the final shader using the WGSL template ---
  const wgsl = generateShader(
    {
      lines,
      uniformStruct,
      shapeFunctions,
      transformHelpers,
      noiseHelpers,
      colorHelpers,
      computeBindings: '', // Compute bindings are now handled by TextureBindings.generate()
    },
    textureBindings
  );

  return {
    wgsl,
    uniformManager: finishUniformState(),
  };
}
