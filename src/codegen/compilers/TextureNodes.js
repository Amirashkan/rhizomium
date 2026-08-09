// src/codegen/compilers/TextureNodes.js
// Texture nodes that *register global WGSL bindings* (group 0) and only emit sampling code in-line.

import { ensureTextTexture } from '../../core/TextRasterizer.js';

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
    return ["Texture2D", "TextureCube", "Text"].includes(kind);
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
      case "Text":
        return this.compileText(node, getInput, nodeId);
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

    // Single Color (RGBA) output. Channels are extracted downstream with a
    // Split Vec4 node rather than per-channel output pins.
    const outputPins = [
      { expression: `node_${nodeId}_rgba`, type: "vec4" }, // Color (RGBA)
    ];

    return { line, outputType: "vec4", outputPins };
  }

  /**
   * Text node: samples the bitmap the node rasterised from its own parameters. The binding pair is
   * the same one Texture2D uses (TextureBindings emits it for this kind too), so from the shader's
   * point of view this is an image whose pixels happen to be glyphs.
   */
  compileText(node, getInput, nodeId) {
    // Rasterise before the shader that samples it exists. Cheap when nothing changed: the call is
    // a cache-key comparison and an early return. Unlike Texture2D's preview side effect this also
    // runs during subgraph compilation — that build is how a Text node which isn't wired to the
    // output (its own thumbnail render) gets a texture at all, and re-entering here is harmless
    // because the upload is idempotent and triggers no render of its own.
    ensureTextTexture(node);

    // Bound the incoming UV once: it can be a converted expression, and the fit and clamp maths
    // below read it several more times.
    const uv = getInput(0, "vec2", "in.uv");

    let line = `let srcuv_${nodeId} = ${uv};`;

    // The bitmap is square; the output usually isn't. Sampling the unit square straight across a
    // 16:9 frame is what stretches the letters, so measure in aspect space and map the square onto
    // the frame at its own proportions:
    //   contain  the whole square fits inside the frame (letterboxed) - the default, because text
    //            that has been cropped is worse than text with margins
    //   cover    the square fills the frame and overflows on the long axis
    //   stretch  no correction: the square is distorted to fill, the old behaviour
    // `u.aspect` is the same width/height the Circle/Rectangle/Polygon nodes measure against.
    const fit = node.params?.fit ?? "contain";
    if (fit === "stretch") {
      line += `
    let fituv_${nodeId} = srcuv_${nodeId};`;
    } else {
      const extent = fit === "cover" ? "max(u.aspect, 1.0)" : "min(u.aspect, 1.0)";
      line += `
    let fitscale_${nodeId} = ${extent};
    let fituv_${nodeId} = vec2<f32>(
      (srcuv_${nodeId}.x * u.aspect - u.aspect * 0.5) / fitscale_${nodeId} + 0.5,
      (srcuv_${nodeId}.y - 0.5) / fitscale_${nodeId} + 0.5
    );`;
    }

    // Y flip matches Texture2D / Compute sampling, so the text reads the right way up.
    line += `
    let uv_${nodeId} = vec2<f32>(fituv_${nodeId}.x, 1.0 - fituv_${nodeId}.y);
    let node_${nodeId}_rgba = textureSample(texture_${nodeId}, sampler_${nodeId}, uv_${nodeId});`;

    // In clamp mode the texture's edge pixels would otherwise smear outward forever once the fit
    // or a transform pushes the coordinate past the unit square — including across the whole
    // letterbox that "contain" creates. Zeroing outside it keeps the text confined to its own
    // frame; repeat/mirror deliberately tile instead.
    if ((node.params?.wrap ?? "clamp") === "clamp") {
      line += `
    let inside_${nodeId} = step(0.0, fituv_${nodeId}.x) * step(fituv_${nodeId}.x, 1.0) * step(0.0, fituv_${nodeId}.y) * step(fituv_${nodeId}.y, 1.0);
    let node_${nodeId}_tex = node_${nodeId}_rgba * inside_${nodeId};`;
    } else {
      line += `
    let node_${nodeId}_tex = node_${nodeId}_rgba;`;
    }

    line += `
    let node_${nodeId} = node_${nodeId}_tex;`;

    return {
      line,
      outputType: "vec4",
      outputPins: [
        { expression: `node_${nodeId}_tex`, type: "vec4" },   // Color
        { expression: `node_${nodeId}_tex.a`, type: "f32" },  // Mask (glyph coverage)
      ],
    };
  }

  compileTextureCube(node, getInput, nodeId) {
    const dir = getInput(0, "vec3", 
      "normalize(vec3<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0, 1.0))");
    const textureId = nodeId;
    
    const line = `let node_${nodeId}_rgba = textureSample(textureCube_${textureId}, samplerCube_${textureId}, ${dir});
    let node_${nodeId} = node_${nodeId}_rgba;`;

    // Single Color (RGBA) output. Use a Split Vec4 node for channels.
    const outputPins = [
      { expression: `node_${nodeId}_rgba`, type: "vec4" }, // Color (RGBA)
    ];

    return { line, outputType: "vec4", outputPins };
  }
}
