// src/codegen/glslBuilder.js
import { GraphProcessor } from './processors/GraphProcessor.js';
import { TypeConverter } from './processors/TypeConverter.js';
import { NodeCompiler } from './processors/NodeCompiler.js';
import { TextureBindings } from './generators/TextureBindings.js';
import { generateShader } from './templates/ShaderTemplate.js';

/**
 * Main WGSL builder for Rhizomium
 * Compiles node graph into a valid WGSL shader source.
 */
export function buildWGSL(graph) {
  const processor = new GraphProcessor();

  // Shared NodeCompiler instance
  if (!window.nodeCompiler) {
    window.nodeCompiler = new NodeCompiler();
  }
  const compiler = window.nodeCompiler;

  // --- Clear all cached state before building ---
  compiler.uniformManager.clear();
  console.log('✅ Cleared uniform manager');
  processor.clearFunctionCollection();

  if (compiler.compilers.field && compiler.compilers.field.clearFunctionCache) {
    compiler.compilers.field.clearFunctionCache();
    console.log('✅ Cleared field function cache');
  }

  if (compiler.compilers.transform && compiler.compilers.transform.clearHelperCache) {
    compiler.compilers.transform.clearHelperCache();
  }

  // --- Process the graph ---
  const result = processor.processGraph(graph);
  const { orderedNodes, outputNode } = result;

  if (!outputNode || orderedNodes.length === 0) {
    console.warn('⚠️ No output node found or empty graph');
    return { wgsl: '', uniformManager: compiler.uniformManager };
  }

  // --- Compile all nodes into WGSL lines ---
  const compiledData = compiler.compileNodes(orderedNodes);
  const { lines, uniformStruct, uniformManager, usesNoise } = compiledData;

  // --- Collect all function definitions and helpers ---
  const shapeFunctions = compiler.compilers.field?.getAllFunctionDefinitions
    ? compiler.compilers.field.getAllFunctionDefinitions()
    : '';
  console.log('✅ Injecting shapeFunctions:', shapeFunctions);

  const transformHelpers = compiler.compilers.transform?.getHelperFunctions
    ? compiler.compilers.transform.getHelperFunctions()
    : '';

  const noiseHelpers = usesNoise && compiler.compilers.noise?.getHelperFunctions
    ? compiler.compilers.noise.getHelperFunctions()
    : '';

  const colorHelpers = compiler.compilers.utility?.getHelperFunctions
    ? compiler.compilers.utility.getHelperFunctions()
    : '';

  const textureBindings = TextureBindings.generate(graph);

  // --- Build the final shader using the WGSL template ---
  const wgsl = generateShader(
    {
      lines,
      uniformStruct,
      shapeFunctions,
      transformHelpers,
      noiseHelpers,
      colorHelpers,
    },
    textureBindings
  );

  return {
    wgsl,
    uniformManager,
  };
}
