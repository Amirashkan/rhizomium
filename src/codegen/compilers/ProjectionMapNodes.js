// src/codegen/compilers/ProjectionMapNodes.js
//
// Compiles the ProjectionMap node: the projection-mapping surfaces, in the shader.
//
// Each input pin is one surface's own source, sampled as a texture so it can be
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

import { MAX_MAPPED_SURFACES, MAX_MASK_POINTS } from '../../data/nodes/UtilityNodes.js';
import { getInputCount } from '../../data/nodeInputs.js';

/** Below this the surface has collapsed to a line and has nothing to sample. */
const W_EPSILON = '1e-6';

/**
 * Setup visuals, drawn into the node's own output so they land on the PROJECTOR.
 *
 * Aligning a rig means looking at the wall, not at the editor, so a surface's
 * outline and the shape being drawn have to be visible on the physical object.
 *
 * Geometry is done in PIXELS rather than in the frame's 0..1 space: a line of
 * constant width in normalised units is thicker across than down on anything
 * that is not square, and working in pixels also avoids derivatives, which the
 * surface clip test has already shown are awkward here.
 */
const GUIDE_HELPERS = /* wgsl */`
fn rzGuideSegDist(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

/** 1 on the stroke, fading over a pixel so the line does not crawl. */
fn rzGuideStroke(d: f32, w: f32) -> f32 {
  return 1.0 - smoothstep(w, w + 1.0, d);
}

/** Inverse of a 3x3, or the identity when it has collapsed. */
fn rzInverse3(m: mat3x3<f32>) -> mat3x3<f32> {
  let a = m[0][0]; let b = m[1][0]; let c = m[2][0];
  let d = m[0][1]; let e = m[1][1]; let f = m[2][1];
  let gg = m[0][2]; let h = m[1][2]; let i = m[2][2];
  let A = e * i - f * h;
  let B = f * gg - d * i;
  let C = d * h - e * gg;
  let det = a * A + b * B + c * C;
  if (abs(det) < 1e-9) {
    return mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
  }
  let s = 1.0 / det;
  // mat3x3 is constructed from COLUMNS, and the adjugate below reads naturally
  // as rows, so each column is spelled out as a vec3 rather than trusting the
  // nine-scalar form: written flat it transposes silently, and a transposed
  // inverse still looks like a plausible mapping — the outline lands somewhere,
  // just not on the surface.
  return mat3x3<f32>(
    vec3<f32>(A, B, C) * s,
    vec3<f32>(c * h - b * i, a * i - c * gg, b * gg - a * h) * s,
    vec3<f32>(b * f - c * e, c * d - a * f, a * e - b * d) * s,
  );
}

/** Apply a 3x3 to a 2D point, dividing through by w. */
fn rzProject(m: mat3x3<f32>, p: vec2<f32>) -> vec2<f32> {
  let h = m * vec3<f32>(p, 1.0);
  if (abs(h.z) < 1e-6) { return p; }
  return h.xy / h.z;
}
`;

/** Guide colours: the surface outline, and the shape being drawn on it. */
const GUIDE_RGB = 'vec3<f32>(0.78, 0.95, 0.31)';
const GUIDE_MARK_RGB = 'vec3<f32>(1.0, 1.0, 1.0)';
const GUIDE_LINE_PX = '1.5';
const GUIDE_POINT_PX = '4.0';
/** The centre axes, cool so they never read as a surface edge. */
const AXIS_RGB = 'vec3<f32>(0.35, 0.78, 1.0)';
const AXIS_DASH_PX = '12.0';
const AXIS_CROSS_PX = '9.0';

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

  /**
   * Top-level helpers the guide code calls. Emitted whether or not any node
   * uses them — WGSL drops unreferenced functions, and threading "does this
   * graph draw guides" through the builder to save a few lines is not worth it.
   */
  getHelperFunctions() {
    return GUIDE_HELPERS;
  }

  /** Whether this node is drawing its setup visuals into the output. */
  _guidesOn(node) {
    return Number(node.params?.guides) > 0.5;
  }

  /**
   * How many surfaces the guides cover.
   *
   * Deliberately NOT the pin count. A surface only grows a pin once it is given
   * a source of its own, and the order of work is the other way round: you draw
   * the outline onto the object first, with the projector showing you where the
   * edges land, and decide what to play on it afterwards. Keying the guides off
   * pins would hide the outline of every surface until it had content, which is
   * precisely when the outline is the only thing there is to see.
   *
   * @returns {number}
   */
  _guideSurfaceCount(node, pinCount) {
    const declared = Number(node.params?.sn);
    const count = Number.isFinite(declared) ? Math.floor(declared) : 0;
    return Math.min(Math.max(count, pinCount), MAX_MAPPED_SURFACES);
  }

  /**
   * WGSL drawing a surface's outline, its shape, and the shape's points.
   * @returns {string}
   */
  _compileSurfaceGuides(node, nodeId, index, maskCount) {
    const u = (name) => this._uniform(node, name);
    const tag = `${nodeId}_s${index}`;
    // The node carries matrices, not corners, so the outline is drawn by
    // pushing the unit square back OUT through the inverse of dstToUnit.
    let code = `
  // --- surface ${index + 1} guides ---
  {
    let gm_${tag} = mat3x3<f32>(
      ${u(`s${index}m0`)}, ${u(`s${index}m3`)}, ${u(`s${index}m6`)},
      ${u(`s${index}m1`)}, ${u(`s${index}m4`)}, ${u(`s${index}m7`)},
      ${u(`s${index}m2`)}, ${u(`s${index}m5`)}, ${u(`s${index}m8`)}
    );
    let gi_${tag} = rzInverse3(gm_${tag});`;

    // Quad outline: the unit square pushed back out into output space.
    const uc = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      const a = uc[i];
      const b = uc[(i + 1) % 4];
      code += `
    {
      let ga_${tag}_${i} = rzProject(gi_${tag}, vec2<f32>(${a[0]}.0, ${a[1]}.0)) * g.resolution;
      let gb_${tag}_${i} = rzProject(gi_${tag}, vec2<f32>(${b[0]}.0, ${b[1]}.0)) * g.resolution;
      guide_${nodeId} = max(guide_${nodeId},
        rzGuideStroke(rzGuideSegDist(gp_${nodeId}, ga_${tag}_${i}, gb_${tag}_${i}), ${GUIDE_LINE_PX}));
      guideMark_${nodeId} = max(guideMark_${nodeId},
        rzGuideStroke(length(gp_${nodeId} - ga_${tag}_${i}), ${GUIDE_POINT_PX}));
    }`;
    }

    // The shape, and a dot on every one of its points.
    for (let k = 0; k < maskCount; k++) {
      const j = (k + 1) % maskCount;
      code += `
    {
      let ka_${tag}_${k} = rzProject(gi_${tag}, vec2<f32>(${u(`s${index}k${k}x`)}, ${u(`s${index}k${k}y`)})) * g.resolution;
      let kb_${tag}_${k} = rzProject(gi_${tag}, vec2<f32>(${u(`s${index}k${j}x`)}, ${u(`s${index}k${j}y`)})) * g.resolution;
      guide_${nodeId} = max(guide_${nodeId},
        rzGuideStroke(rzGuideSegDist(gp_${nodeId}, ka_${tag}_${k}, kb_${tag}_${k}), ${GUIDE_LINE_PX}));
      guide_${nodeId} = max(guide_${nodeId},
        rzGuideStroke(length(gp_${nodeId} - ka_${tag}_${k}), ${GUIDE_POINT_PX} - 1.0));
    }`;
    }

    code += `
  }`;
    return code;
  }

  /** Whether this node is drawing the frame's centre lines. */
  _axesOn(node) {
    return Number(node.params?.axes) > 0.5;
  }

  /**
   * WGSL for the frame's centre lines.
   *
   * A shape traced freehand onto an object has nothing to be square to. The
   * centre is the one landmark every frame shares, so the axes give a click
   * something to be measured against — and they have to be on the PROJECTOR,
   * since the shape is being aimed at the object and not at the editor.
   *
   * Dashed, and drawn at the centre of the frame rather than of any surface:
   * this is the projector's own reference, which is what a rig is squared to.
   */
  _compileAxisGuides(node, nodeId) {
    const u = (name) => this._uniform(node, name);
    return `
  // --- axes ---
  {
    let axhome_${nodeId} = vec2<f32>(0.5, 0.5);
    // Centred on the POINTER while it is on the stage — a point is lined up
    // against something already on the object far more often than against the
    // middle of the frame — and back on the frame's centre once it leaves, so
    // the reference never simply vanishes. A uniform, so following the hand is
    // a buffer write and not a recompile.
    let axat_${nodeId} = mix(axhome_${nodeId},
      vec2<f32>(${u('axx')}, ${u('axy')}), ${u('axOn')}) * g.resolution;
    let axd_${nodeId} = abs(gp_${nodeId} - axat_${nodeId});
    // Dashes run along each line, so the axes read as a reference rather than
    // as one more edge to align something to.
    let axdash_${nodeId} = vec2<f32>(
      step(0.5, fract(gp_${nodeId}.y / ${AXIS_DASH_PX})),
      step(0.5, fract(gp_${nodeId}.x / ${AXIS_DASH_PX}))
    );
    axis_${nodeId} = max(axis_${nodeId},
      axdash_${nodeId}.x * rzGuideStroke(axd_${nodeId}.x, 1.0));
    axis_${nodeId} = max(axis_${nodeId},
      axdash_${nodeId}.y * rzGuideStroke(axd_${nodeId}.y, 1.0));
    // Solid where they cross, so the exact spot is a mark and not just where
    // two dashed lines happen to meet.
    let axnear_${nodeId} = step(max(axd_${nodeId}.x, axd_${nodeId}.y), ${AXIS_CROSS_PX});
    axis_${nodeId} = max(axis_${nodeId},
      axnear_${nodeId} * rzGuideStroke(min(axd_${nodeId}.x, axd_${nodeId}.y), 1.0));

    // The frame's centre keeps a mark of its own, so it stays findable while
    // the axes are away following the pointer.
    let axhd_${nodeId} = abs(gp_${nodeId} - axhome_${nodeId} * g.resolution);
    let axhn_${nodeId} = step(max(axhd_${nodeId}.x, axhd_${nodeId}.y), ${AXIS_CROSS_PX});
    axis_${nodeId} = max(axis_${nodeId},
      axhn_${nodeId} * rzGuideStroke(min(axhd_${nodeId}.x, axhd_${nodeId}.y), 1.0));
  }`;
  }

  /**
   * WGSL for the outline being drawn right now: the points placed so far, a
   * rubber band out to the cursor, and a ghost of the point the next click
   * would place.
   *
   * Every slot is emitted and masked by the live count, so placing a point is a
   * uniform write rather than a recompile — otherwise the shader would rebuild
   * on every click while drawing.
   */
  _compileDraftGuides(node, nodeId) {
    const u = (name) => this._uniform(node, name);
    let code = `
  // --- the outline being drawn ---
  {
    let dn_${nodeId} = ${u('dn')};
    let dc_${nodeId} = vec2<f32>(${u('dcx')}, ${u('dcy')}) * g.resolution;
    let dcOn_${nodeId} = ${u('dcOn')};`;

    for (let k = 0; k < MAX_MASK_POINTS; k++) {
      const j = k + 1;
      code += `
    {
      let da_${nodeId}_${k} = vec2<f32>(${u(`d${k}x`)}, ${u(`d${k}y`)}) * g.resolution;
      let live_${nodeId}_${k} = step(${k}.0 + 0.5, dn_${nodeId});
      // A dot on the point itself.
      guide_${nodeId} = max(guide_${nodeId},
        live_${nodeId}_${k} * rzGuideStroke(length(gp_${nodeId} - da_${nodeId}_${k}), ${GUIDE_POINT_PX}));
      // The segment on to the next point, or the rubber band to the cursor when
      // this is the last one placed.
      let nextIsPoint_${nodeId}_${k} = step(${j}.0 + 0.5, dn_${nodeId});
      let db_${nodeId}_${k} = select(dc_${nodeId},
        vec2<f32>(${u(`d${j < MAX_MASK_POINTS ? j : 0}x`)}, ${u(`d${j < MAX_MASK_POINTS ? j : 0}y`)}) * g.resolution,
        nextIsPoint_${nodeId}_${k} > 0.5);
      let hasEnd_${nodeId}_${k} = max(nextIsPoint_${nodeId}_${k}, dcOn_${nodeId});
      guide_${nodeId} = max(guide_${nodeId},
        live_${nodeId}_${k} * hasEnd_${nodeId}_${k}
        * rzGuideStroke(rzGuideSegDist(gp_${nodeId}, da_${nodeId}_${k}, db_${nodeId}_${k}), ${GUIDE_LINE_PX}));
    }`;
    }

    // The ghost: where the next click lands, shown before it is committed.
    code += `
    guideMark_${nodeId} = max(guideMark_${nodeId},
      dcOn_${nodeId} * rzGuideStroke(abs(length(gp_${nodeId} - dc_${nodeId}) - ${GUIDE_POINT_PX}), 1.0));
  }`;
    return code;
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
   * How many mask points a surface carries, read from the node at COMPILE time —
   * the crossing test below is unrolled, so the count is structural. Fewer than
   * three points enclose no area and are treated as no mask.
   *
   * @returns {number}
   */
  _maskCount(node, index) {
    const raw = Number(node.params?.[`s${index}kn`]);
    if (!Number.isFinite(raw) || raw < 3) return 0;
    return Math.min(Math.floor(raw), MAX_MASK_POINTS);
  }

  /**
   * Crossing-number point-in-polygon over the surface's mask, unrolled.
   *
   * The points are separate uniforms rather than an array — that is what keeps
   * dragging one a buffer write — so the loop cannot be dynamic. Unrolling is
   * free here: the count only changes when a point is added, which recompiles
   * anyway.
   *
   * @returns {string} WGSL declaring `inside_<tag>`, or '' when unmasked
   */
  _compileMask(node, index, tag, count) {
    if (count < 3) return '';
    const u = (name) => this._uniform(node, name);
    const px = (k) => u(`s${index}k${k}x`);
    const py = (k) => u(`s${index}k${k}y`);

    let code = `
        var inside_${tag} = false;`;
    for (let i = 0; i < count; i++) {
      const j = (i + count - 1) % count; // previous point, wrapping
      code += `
        {
          let ax_${tag}_${i} = ${px(i)}; let ay_${tag}_${i} = ${py(i)};
          let bx_${tag}_${i} = ${px(j)}; let by_${tag}_${i} = ${py(j)};
          // Count the edges a ray cast from this point crosses. Ray casting
          // rather than a half-plane test, so a concave mask - a notch cut
          // around a pillar - is not silently filled in.
          if ((ay_${tag}_${i} > q_${tag}.y) != (by_${tag}_${i} > q_${tag}.y)) {
            let t_${tag}_${i} = (q_${tag}.y - ay_${tag}_${i}) / (by_${tag}_${i} - ay_${tag}_${i});
            if (q_${tag}.x < ax_${tag}_${i} + t_${tag}_${i} * (bx_${tag}_${i} - ax_${tag}_${i})) {
              inside_${tag} = !inside_${tag};
            }
          }
        }`;
    }
    return code;
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
    const maskCount = this._maskCount(node, index);
    const maskTest = this._compileMask(node, index, tag, maskCount);
    const maskGuard = maskCount >= 3 ? `${maskTest}
        if (inside_${tag}) {` : '';
    const maskClose = maskCount >= 3 ? `
        }` : '';

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
      if (q_${tag}.x >= 0.0 && q_${tag}.x <= 1.0 && q_${tag}.y >= 0.0 && q_${tag}.y <= 1.0) {${maskGuard}
        let hs_${tag} = vec3<f32>(
          ${n(0)} * q_${tag}.x + ${n(1)} * q_${tag}.y + ${n(2)},
          ${n(3)} * q_${tag}.x + ${n(4)} * q_${tag}.y + ${n(5)},
          ${n(6)} * q_${tag}.x + ${n(7)} * q_${tag}.y + ${n(8)}
        );
        if (abs(hs_${tag}.z) > ${W_EPSILON}) {
          // Already in the composition's own top-down space, which is what the
          // source's texture is stored in — no further flip.
          let suv_${tag} = hs_${tag}.xy / hs_${tag}.z;
          // textureSampleLevel, not textureSample: the sample sits inside the
          // surface's clip test, which is non-uniform control source, and WGSL
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
        }${maskClose}
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
      // is routinely built one source at a time.
      if (!binding) continue;
      surfaces.push(this._compileSurface(node, nodeId, i, binding));
    }

    const guides = this._guidesOn(node);
    let guideCode = '';
    if (guides) {
      const axes = this._axesOn(node);
      guideCode = `
  // --- setup visuals ---
  var guide_${nodeId} = 0.0;
  var guideMark_${nodeId} = 0.0;
  var axis_${nodeId} = 0.0;
  let gp_${nodeId} = map_uv_${nodeId} * g.resolution;`;
      // Axes first, so a surface outline always draws over them.
      if (axes) guideCode += this._compileAxisGuides(node, nodeId);
      const guided = this._guideSurfaceCount(node, pinCount);
      for (let i = 0; i < guided; i++) {
        guideCode += this._compileSurfaceGuides(node, nodeId, i, this._maskCount(node, i));
      }
      guideCode += this._compileDraftGuides(node, nodeId);
      // Guides go OVER the mapping and carry their own alpha, so they show on a
      // surface and on the black around it alike — a rig is aligned against the
      // object, and the outline has to be visible off the content too.
      guideCode += `
  map_rgb_${nodeId} = mix(map_rgb_${nodeId}, ${AXIS_RGB}, clamp(axis_${nodeId}, 0.0, 1.0));
  map_rgb_${nodeId} = mix(map_rgb_${nodeId}, ${GUIDE_RGB}, clamp(guide_${nodeId}, 0.0, 1.0));
  map_rgb_${nodeId} = mix(map_rgb_${nodeId}, ${GUIDE_MARK_RGB}, clamp(guideMark_${nodeId}, 0.0, 1.0));
  map_a_${nodeId} = max(map_a_${nodeId},
    clamp(max(axis_${nodeId}, max(guide_${nodeId}, guideMark_${nodeId})), 0.0, 1.0));`;
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
      line: `${header}${surfaces.join('')}${guideCode}
  let node_${nodeId} = vec4<f32>(map_rgb_${nodeId}, map_a_${nodeId});`,
      outputType: 'vec4',
    };
  }
}

export default ProjectionMapNodes;
