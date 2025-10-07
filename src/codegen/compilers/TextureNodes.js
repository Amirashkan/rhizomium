// src/codegen/compilers/TextureNodes.js
// Texture nodes that *register global WGSL bindings* (group 0) and only emit sampling code in-line.

export class TextureNodes {
  constructor(builder, uniformManager) {
    // `builder` is your glslBuilder / wgslBuilder instance (see patch below).
    // It exposes `addGlobalDecl(str)` so we can push global-scope declarations.
    this.builder = builder;
    this.uniformManager = uniformManager;
  }

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
    window.editor?.previewIntegration?.onParameterChange?.(node);

    const uv = getInput(0, "vec2", "in.uv");

    // 1) Ensure GLOBAL declarations (NOT inline!)
    this.builder.addGlobalDecl(`@group(0) @binding(2) var sampler_${nodeId}: sampler;`);
    this.builder.addGlobalDecl(`@group(0) @binding(3) var texture_${nodeId}: texture_2d<f32>;`);

    // 2) Inline sampling (NO aspect on texture sampling to prevent double-correction/stretches).
    // Shapes are aspect-correct; textures sample in UV space unless a fit mode is added.
    const line = `
let uv_${nodeId} = vec2<f32>(${uv}.x, 1.0 - ${uv}.y);
let node_${nodeId}_rgba = textureSample(texture_${nodeId}, sampler_${nodeId}, uv_${nodeId});
let node_${nodeId} = node_${nodeId}_rgba;
`;

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
    const dir = getInput(
      0,
      "vec3",
      "normalize(vec3<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0, 1.0))"
    );
    if (!this.builder && typeof window !== 'undefined' && window.wgslBuilder) {
      this.builder = window.wgslBuilder;
    }

    // Global scope declarations
    this.builder.addGlobalDecl(`@group(0) @binding(2) var samplerCube_${nodeId}: sampler;`);
    this.builder.addGlobalDecl(`@group(0) @binding(3) var textureCube_${nodeId}: texture_cube<f32>;`);

    const line = `
let node_${nodeId}_rgba = textureSample(textureCube_${nodeId}, samplerCube_${nodeId}, ${dir});
let node_${nodeId} = node_${nodeId}_rgba;
`;

    const outputPins = [
      { expression: `node_${nodeId}_rgba`, type: "vec4" },
      { expression: `node_${nodeId}_rgba.xyz`, type: "vec3" },
      { expression: `node_${nodeId}_rgba.a`, type: "f32" },
    ];

    return { line, outputType: "vec4", outputPins };
  }
}
