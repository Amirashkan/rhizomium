// src/data/nodes/TransformNodes.js

/**
 * Transform node definitions for UV coordinate manipulation
 *
 * NOTE: All nodes here operate on UV coordinates in the fragment shader (vec2 in/out).
 * They are NOT compatible with compute node outputs (which are vec4 textures).
 * Use ComputeTransform for transforming compute node outputs in the compute pipeline.
 *
 * Note: Kaleidoscope has been moved to ComputeKaleidoscope for better
 * performance and additional features (animation support).
 */
export const TransformNodes = {
  // === BASIC TRANSFORMS ===
  Transform2D: {
    label: "Transform 2D",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "translateX", type: "float", default: 0.0, label: "Translate X" },
      { name: "translateY", type: "float", default: 0.0, label: "Translate Y" },
      { name: "scaleX", type: "float", default: 1.0, label: "Scale X" },
      { name: "scaleY", type: "float", default: 1.0, label: "Scale Y" },
      { name: "rotation", type: "float", default: 0.0, label: "Rotation" },
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
    ],
  },

  Scale2D: {
    label: "Scale 2D",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "scaleX", type: "float", default: 1.0, label: "Scale X" },
      { name: "scaleY", type: "float", default: 1.0, label: "Scale Y" },
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
    ],
  },

  Rotate2D: {
    label: "Rotate 2D",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "rotation", type: "float", default: 0.0, label: "Rotation" },
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
    ],
  },

  TileAndOffset: {
    label: "Tile and Offset",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "tilingX", type: "float", default: 1.0, label: "Tiling X" },
      { name: "tilingY", type: "float", default: 1.0, label: "Tiling Y" },
      { name: "offsetX", type: "float", default: 0.0, label: "Offset X" },
      { name: "offsetY", type: "float", default: 0.0, label: "Offset Y" },
    ],
  },

  Flip2D: {
    label: "Flip 2D",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "flipX", type: "bool", default: false, label: "Flip X" },
      { name: "flipY", type: "bool", default: false, label: "Flip Y" },
    ],
  },

  // === COORDINATE CONVERSION ===
  UVToColor: {
    label: "UV to Color",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  PolarCoordinates: {
    label: "Polar Coordinates",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
      { name: "radialScale", type: "float", default: 1.0, label: "Radial Scale" },
      { name: "angularScale", type: "float", default: 1.0, label: "Angular Scale" },
    ],
  },

  // === DISTORTION EFFECTS ===
  Spherize: {
    label: "Spherize",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
      { name: "strength", type: "float", default: 0.5, label: "Strength" },
      { name: "radius", type: "float", default: 0.5, label: "Radius" },
    ],
  },

  Twirl: {
    label: "Twirl",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
      { name: "strength", type: "float", default: 1.0, label: "Strength" },
      { name: "radius", type: "float", default: 0.5, label: "Radius" },
    ],
  },

  Displacement: {
    label: "Displacement",
    cat: "Transform",
    inputs: 2,
    pinsIn: ["UV", "Offset"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "strength", type: "float", default: 0.2, label: "Strength" },
      { name: "centered", type: "boolean", default: true, label: "Center Input" },
      { name: "wrap", type: "boolean", default: false, label: "Wrap UV" },
    ],
  },
};
