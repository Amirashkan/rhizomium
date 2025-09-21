// src/codegen/glslBuilder.js - Clean modular version that imports from supporting modules

import { GraphProcessor } from './processors/GraphProcessor.js';
import { TypeConverter } from './processors/TypeConverter.js';
import { NodeCompiler } from './processors/NodeCompiler.js';
import { ShaderTemplate } from './templates/ShaderTemplate.js';
import { TextureBindings } from './generators/TextureBindings.js';

/**
 * Main WGSL builder function - SAME INTERFACE AS YOUR ORIGINAL
 * @param {Object} graph - The node graph to compile
 * @returns {string} Generated WGSL shader code
 */
export function buildWGSL(graph) {
  const processor = new GraphProcessor();
  const compiler = new NodeCompiler();
  const template = new ShaderTemplate();
  
  // Process the graph to get ordered, filtered nodes
  const { orderedNodes, outputNode } = processor.processGraph(graph);
  
  if (!outputNode || orderedNodes.length === 0) {
    return template.getDefaultShader();
  }
  
  // Compile all nodes to shader code
  const { lines, types, expressions } = compiler.compileNodes(orderedNodes);
  
  // Generate texture bindings
  const textureBindings = TextureBindings.generate(graph);
  
  // Build final shader
  return template.buildShader({
    lines,
    textureBindings
  });
}