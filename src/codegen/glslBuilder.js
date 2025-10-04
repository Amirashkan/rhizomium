// src/codegen/glslBuilder.js
import { GraphProcessor } from './processors/GraphProcessor.js';
import { TypeConverter } from './processors/TypeConverter.js';
import { NodeCompiler } from './processors/NodeCompiler.js';
import { ShaderTemplate } from './templates/ShaderTemplate.js';
import { TextureBindings } from './generators/TextureBindings.js';
import { generateShader } from './templates/ShaderTemplate.js';

/**
 * Main WGSL builder function
 * @param {Object} graph - The node graph to compile
 * @returns {Object} { wgsl: string, uniformManager: ParameterUniformManager }
 */
export function buildWGSL(graph) {
  const processor = new GraphProcessor();
  
  if (!window.nodeCompiler) {
    window.nodeCompiler = new NodeCompiler();
  }
  const compiler = window.nodeCompiler;
  
  // IMPORTANT: Clear uniform manager FIRST
  compiler.uniformManager.clear();
  console.log('✅ Cleared uniform manager');
  
  // THEN clear function caches (which may reference the old uniforms)
  processor.clearFunctionCollection();
  if (compiler.compilers.field && compiler.compilers.field.clearFunctionCache) {
    compiler.compilers.field.clearFunctionCache();
    console.log('✅ Cleared field function cache');
  }
  if (compiler.compilers.transform && compiler.compilers.transform.clearHelperCache) {
    compiler.compilers.transform.clearHelperCache();
  }
  
  // Process graph and compile
  const result = processor.processGraph(graph);
  const { orderedNodes, outputNode } = result;
  
  if (!outputNode || orderedNodes.length === 0) {
    return {
      wgsl: template.getDefaultShader(),
      uniformManager: null
    };
  }
  
  const compiledData = compiler.compileNodes(orderedNodes);
  // ... rest

  const { lines, types, expressions, uniformStruct, uniformManager } = compiledData;
  
  // Collect function definitions from field and transform nodes
  const shapeFunctions = compiler.compilers.field.getAllFunctionDefinitions 
    ? compiler.compilers.field.getAllFunctionDefinitions() 
    : '';
  
  const transformHelpers = compiler.compilers.transform.getHelperFunctions
    ? compiler.compilers.transform.getHelperFunctions()
    : '';
  
  // Generate texture bindings
  const textureBindings = TextureBindings.generate(graph);
  
  // Build final shader using the generateShader function with function support
  const wgsl = generateShader(
    { 
      lines, 
      uniformStruct,
      shapeFunctions,    // NEW: Shape function definitions
      transformHelpers   // NEW: Transform helper functions
    },
    textureBindings
  );
  
  return {
    wgsl,
    uniformManager
  };
}