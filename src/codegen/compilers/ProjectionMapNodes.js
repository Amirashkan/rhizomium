// src/codegen/compilers/ProjectionMapNodes.js
//
// Compiles the ProjectionMap node: the projection-mapping surfaces, in the shader.
//
// Each input pin is one surface's own flow, sampled as a texture so it can be
// read at the warped coordinate the surface's quad implies rather than at the
// pixel being shaded. ComputeExecutor bridges any non-compute pin through the
// fragment renderer and publishes it under the source's id, so every pin binds
// as compute_node_<id> whatever kind of node is plugged into it.
//
// The homographies are NOT solved here. Inverting a quad is an 8x8 solve, which
// is hopeless per fragment, and baking a solved matrix into the shader would
// mean recompiling on every mousemove of a corner. They are solved on the CPU
// when a corner moves (src/mapping/homography.js) and arrive as uniforms, so the
// shader does one mat3 multiply per surface and a drag is a buffer write.
//
// Surfaces composite back-to-front with ordinary source-over alpha, matching the
// draw order the mapping panel shows and the order MappingCompositor draws in —
// the two have to agree or aligning in the panel would not mean aligning on the
// projector.

import { MAX_MAPPED_SURFACES } from '../../data/nodes/UtilityNodes.js';
import { getInputCount } from '../../data/nodeInputs.js';

/** Below this the surface has collapsed to a line and has nothing to sample. */
const W_EPSILON = '1e-6';

export class ProjectionMapNodes {
  constructor() {
    this.uniformManager = null;
    this.graph = null;
  }

  setUniformManager(uniformManager) {
    this.uniformManager = uniformManager;
  }

  setGraph(graph) {
    this.graph = graph;
  }

  handles(kind) {
    return kind === 'ProjectionMap';
  }

  /** Uniform reference for one of this node's surface parameters. */
  _uniform(node, paramName) {
    const paramKey = `${node.id}.${paramName}`;
    const sanitized = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
    const field = sanitized.startsWith('_') ? sanitized : `_${sanitized}`;
    // The node declares `alwaysUniform`, so ParameterUniformManager has already
    // put every one of these in the struct; register defensively anyway so a
    // surface still compiles if analyzeNode has not run for this node yet.
    if (this.uniformManager && !this.uniformManager.uniformValues.has(paramKey)) {
      const value = Number(node.params?.[paramName]);
      this.uniformManager.uniformValues.set(paramKey, Number.isFinite(value) ? value : 0);
    }
    return `u_params.${field}`;
  }

  /**
   * The texture a surface pin samples, or null when the pin is empty.
   * @returns {{texture:string, sampler:string}|null}
   */
  _pinTexture(node, pin) {
    const sourceId = node.inputs?.[pin];
    if (sourceId === null || sourceId === undefined) return null;
    const graph = this.graph || window.editor?.graph || window.graph;
    const sourceNode = graph?.nodes?.find(n => String(n.id) === String(sourceId));
    if (!sourceNode) return null;

    const sid = String(sourceId).replace(/[^a-zA-Z0-9_]/g, '_');
    // Text rasterises under the same texture_<id> pair as Texture2D.
    if (sourceNode.kind === 'Texture2D' || sourceNode.kind === 'Text') {
      return { texture: `texture_${sid}`, sampler: `sampler_${sid}` };
    }
    // Compute outputs and fragment subgraphs bridged for this node both live in
    // nodeOutputs, so both bind under the compute_node_<id> pair.
    const bare = sid.startsWith('node_') ? sid.substring(5) : sid;
    return { texture: `compute_node_${bare}`, sampler: `sampler_compute_node_${bare}` };
  }

  /**
   * WGSL for one surface: warp, clip, sample, feather, composite.
   * @returns {string}
   */
  _compileSurface(node, nodeId, index, binding) {
    const u = (name) => this._uniform(node, name);
    const m = (k) => u(`s${index}m${k}`);
    const n = (k) => u(`s${index}n${k}`);
    const tag = `${nodeId}_s${index}`;

    return `
  // --- surface ${index + 1} ---
  {
    let hd_${tag} = vec3<f32>(
      ${m(0)} * map_uv_${nodeId}.x + ${m(1)} * map_uv_${nodeId}.y + ${m(2)},
      ${m(3)} * map_uv_${nodeId}.x + ${m(4)} * map_uv_${nodeId}.y + ${m(5)},
      ${m(6)} * map_uv_${nodeId}.x + ${m(7)} * map_uv_${nodeId}.y + ${m(8)}
    );
    if (abs(hd_${tag}.z) > ${W_EPSILON}) {
      let q_${tag} = hd_${tag}.xy / hd_${tag}.z;
      // Outside the quad this pixel is not on the surface at all.
      if (q_${tag}.x >= 0.0 && q_${tag}.x <= 1.0 && q_${tag}.y >= 0.0 && q_${tag}.y <= 1.0) {
        let hs_${tag} = vec3<f32>(
          ${n(0)} * q_${tag}.x + ${n(1)} * q_${tag}.y + ${n(2)},
          ${n(3)} * q_${tag}.x + ${n(4)} * q_${tag}.y + ${n(5)},
          ${n(6)} * q_${tag}.x + ${n(7)} * q_${tag}.y + ${n(8)}
        );
        if (abs(hs_${tag}.z) > ${W_EPSILON}) {
          // Already in the composition's own top-down space, which is what the
          // flow's texture is stored in — no further flip.
          let suv_${tag} = hs_${tag}.xy / hs_${tag}.z;
          // textureSampleLevel, not textureSample: the sample sits inside the
          // surface's clip test, which is non-uniform control flow, and WGSL
          // forbids implicit-derivative sampling there (neighbouring
          // invocations may have taken the other branch). An explicit LOD needs
          // no derivatives — and a mapped surface samples a full-resolution
          // render with no mip chain to select from anyway.
          let texel_${tag} = textureSampleLevel(${binding.texture}, ${binding.sampler}, suv_${tag}, 0.0);
          var a_${tag} = ${u(`s${index}opacity`)} * texel_${tag}.a;
          let soft_${tag} = ${u(`s${index}soft`)};
          // Feather inside every edge, so two projectors can overlap seamlessly.
          if (soft_${tag} > 0.0) {
            a_${tag} = a_${tag}
              * smoothstep(0.0, soft_${tag}, q_${tag}.x)
              * smoothstep(0.0, soft_${tag}, 1.0 - q_${tag}.x)
              * smoothstep(0.0, soft_${tag}, q_${tag}.y)
              * smoothstep(0.0, soft_${tag}, 1.0 - q_${tag}.y);
          }
          a_${tag} = clamp(a_${tag}, 0.0, 1.0);
          map_rgb_${nodeId} = mix(map_rgb_${nodeId}, texel_${tag}.rgb, a_${tag});
          map_a_${nodeId} = map_a_${nodeId} + (1.0 - map_a_${nodeId}) * a_${tag};
        }
      }
    }
  }`;
  }

  /**
   * @param {Object} node
   * @param {Function} _getInput unused: surfaces sample textures, not pin values
   * @returns {{line:string, outputType:string}}
   */
  compile(node, _getInput = null) {
    const nodeId = String(node.id).replace(/[^a-zA-Z0-9_]/g, '_');
    // getInputCount, not inputs.length: the pin count everything else draws,
    // hit-tests and validates against lives on the node instance. Compiling a
    // surface the canvas is not showing a pin for would put a surface on the
    // projector with no way to see or unwire it.
    const pinCount = Math.min(getInputCount(node), MAX_MAPPED_SURFACES);

    const surfaces = [];
    for (let i = 0; i < pinCount; i++) {
      const binding = this._pinTexture(node, i);
      // An empty pin contributes nothing rather than a black surface — a mapping
      // is routinely built one flow at a time.
      if (!binding) continue;
      surfaces.push(this._compileSurface(node, nodeId, i, binding));
    }

    // Unmapped areas of the projector's field are black and fully transparent:
    // black is what a projector shows for "off", and the alpha lets the node be
    // composited over something else if it is not driving the output directly.
    // in.uv is y-UP; a surface's corners are y-DOWN, the way the mapping panel
    // stores them and the way the frame reads. Converting once here puts the
    // whole chain — placement, clip test, crop, sampling — in one top-down
    // space. Without it a surface pinned to the top of the frame renders at the
    // bottom: the handles and the content mirror about the midline.
    const header = `
  let map_uv_${nodeId} = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
  var map_rgb_${nodeId} = vec3<f32>(0.0);
  var map_a_${nodeId} = 0.0;`;

    return {
      line: `${header}${surfaces.join('')}
  let node_${nodeId} = vec4<f32>(map_rgb_${nodeId}, map_a_${nodeId});`,
      outputType: 'vec4',
    };
  }
}

export default ProjectionMapNodes;
