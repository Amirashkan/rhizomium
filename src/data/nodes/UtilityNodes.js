// src/data/nodes/UtilityNodes.js

/**
 * Utility node definitions for data manipulation and conversion
 */

/**
 * Surfaces a {@link UtilityNodes.ProjectionMap} node can carry. Matches the
 * swatch/tint count the mapping panel and compositor colour surfaces with, so a
 * surface has the same identity everywhere it is drawn.
 */
export const MAX_MAPPED_SURFACES = 6;

/** Points a surface's mask may have; mirrors MAX_MASK_POINTS in MappingModel. */
export const MAX_MASK_POINTS = 8;

/** Identity 3x3, row-major: the whole frame showing the whole source. */
const IDENTITY_MAT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Per-surface parameters for the ProjectionMap node.
 *
 * The shader needs MATRICES, not corners. Inverting a quad per fragment is an
 * 8x8 solve, so the homographies are solved once on the CPU whenever a corner
 * moves (see src/mapping/homography.js) and arrive here already inverted:
 *   m0..m8  output space -> this surface's unit square
 *   n0..n8  unit square  -> the crop of the source to show
 * The corners themselves live in the MappingModel, which is what the panel edits
 * and what the project file carries; these are the projection of that state onto
 * what the GPU actually reads.
 *
 * They are `hidden` because the panel maintains them - nobody aligns a projector
 * by typing matrix coefficients - and they are separate float params rather than
 * one packed blob so each is uniform-backed individually, which is what keeps a
 * corner drag a buffer write instead of a shader rebuild on every mousemove.
 */
function buildProjectionMapParams() {
  const params = [];
  for (let i = 0; i < MAX_MAPPED_SURFACES; i++) {
    for (let k = 0; k < 9; k++) {
      params.push({ name: `s${i}m${k}`, type: "float", default: IDENTITY_MAT3[k], hidden: true });
      params.push({ name: `s${i}n${k}`, type: "float", default: IDENTITY_MAT3[k], hidden: true });
    }
    params.push({ name: `s${i}opacity`, type: "float", default: 1.0, hidden: true });
    params.push({ name: `s${i}soft`, type: "float", default: 0.0, hidden: true });
    // Mask polygon, in the surface's own unit space. The count is structural —
    // the shader unrolls the crossing test — so adding a point recompiles while
    // dragging one stays a uniform write, which is the right way round: points
    // are added a few at a time and moved continuously.
    params.push({ name: `s${i}kn`, type: "float", default: 0, hidden: true });
    for (let k = 0; k < MAX_MASK_POINTS; k++) {
      params.push({ name: `s${i}k${k}x`, type: "float", default: 0, hidden: true });
      params.push({ name: `s${i}k${k}y`, type: "float", default: 0, hidden: true });
    }
  }
  return params;
}

export const UtilityNodes = {
  Expr: {
    label: "Expression",
    cat: "Utility",
    inputs: 2,
    pinsIn: ["a", "b"],
    pinsOut: [{ label: "out", type: "f32" }],
    // Extra pins continue the a/b naming (c, d, …) and are addressable by that name in the
    // expression itself.
    dynamicInputs: { min: 1, max: 8, labelStyle: "lowerLetter" },
    params: [
      { name: "expr", type: "expression", default: "a", label: "Expression" },
    ],
  },

  Remap: {
    label: "Remap",
    cat: "Utility",
    inputs: 1,
    pinsIn: ["Value"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { name: "inMin", type: "float", default: 0.0, label: "In Min" },
      { name: "inMax", type: "float", default: 1.0, label: "In Max" },
      { name: "outMin", type: "float", default: 0.0, label: "Out Min" },
      { name: "outMax", type: "float", default: 1.0, label: "Out Max" },
      { name: "clamp", type: "bool", default: false, label: "Clamp" },
    ],
  },

  Posterize: {
    label: "Posterize",
    cat: "Utility",
    inputs: 1,
    pinsIn: ["Value"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { name: "steps", type: "float", default: 8.0, label: "Steps" },
    ],
  },

  Select: {
    label: "Select",
    cat: "Utility",
    inputs: 3,
    pinsIn: ["A", "B", "Condition"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
    ],
  },

  Compare: {
    label: "Compare",
    cat: "Utility",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { 
        name: "operator", 
        type: "select",
        default: "greater",
        options: ["equal", "notEqual", "greater", "greaterEqual", "less", "lessEqual"],
        label: "Operator"
      },
      { name: "epsilon", type: "float", default: 0.001, label: "Epsilon" },
    ],
  },

  Switch: {
    label: "Switch",
    cat: "Utility",
    inputs: 4,
    pinsIn: ["A", "B", "C", "D"],
    pinsOut: [{ label: "out", type: "f32" }],
    // Extra pins continue the A/B/C/D naming (E, F, …). `select` addresses pins by index, so its
    // upper bound follows the live pin count (see maxFromInputCount).
    dynamicInputs: { min: 2, max: 8, labelStyle: "upperLetter" },
    params: [
      {
        name: "select",
        type: "int",
        default: 0,
        min: 0,
        max: 3,
        maxFromInputCount: true,
        label: "Select"
      },
      {
        name: "outputType",
        type: "select",
        default: "f32",
        options: ["f32", "vec2", "vec3", "vec4"],
        label: "Output Type"
      },
    ],
  },

  /**
   * ProjectionMap - corner-pin each input onto its own quad of the frame.
   *
   * This is the projection-mapping surfaces represented IN THE GRAPH: one input
   * pin per surface, so each surface can be fed its own source. It is what carries
   * a mapping to the projector - the second-monitor window re-renders the
   * editor's broadcast WGSL, so a mapping that lives in the shader arrives there
   * (and in the floating preview, and in an export) with nothing mapping-shaped
   * having to cross the wire.
   *
   * It does not replace the mapping panel's own compositor: the panel still
   * warps interactively for editing, and a surface with no pin connected falls
   * back to the composition the way it always did. The node adds the per-surface
   * SOURCE, and the shader path that reaches the output.
   *
   * Inputs are sampled as textures, since a surface has to be read at the warped
   * coordinate its quad implies rather than at the pixel being shaded.
   *
   * The corner params are maintained by the mapping panel - see
   * buildProjectionMapParams above for why they look the way they do.
   */
  ProjectionMap: {
    label: "Projection Map",
    cat: "Utility",
    inputs: 1,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "vec4" }],
    dynamicInputs: {
      min: 1,
      max: MAX_MAPPED_SURFACES,
      labelStyle: "index1",
      labelPrefix: "Surface ",
    },
    // Every corner is a live uniform: aligning a rig is a continuous drag, and a
    // recompile per mousemove would make it unusable.
    alwaysUniform: true,
    params: buildProjectionMapParams(),
  },

  CustomGLSL: {
    label: "Custom GLSL",
    cat: "Utility",
    inputs: 4,
    pinsIn: ["Input 0", "Input 1", "Input 2", "Input 3"],
    pinsOut: [{ label: "out", type: "f32" }],
    // Extra pins continue the numbering ("Input 4", …) and are referenced as input4, input5, … in
    // the code. Capped at 8 so `input1` can never be a prefix of a two-digit input name.
    dynamicInputs: { min: 1, max: 8, labelStyle: "index0", labelPrefix: "Input " },
    params: [
      {
        name: "code",
        type: "glsl",
        default: "// Custom GLSL/WGSL code\n// Use input0, input1, input2, input3 to reference inputs\n// Example: sin(input0) * 2.0\ninput0",
        label: "Code"
      },
      {
        name: "outputType",
        type: "select",
        default: "f32",
        options: ["f32", "vec2", "vec3", "vec4"],
        label: "Output Type"
      },
    ],
  },
};
