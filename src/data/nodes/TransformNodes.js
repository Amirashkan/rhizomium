// src/data/nodes/TransformNodes.js

/**
 * Transform node definitions for UV coordinate transformation
 */
export const TransformNodes = {
  Transform2D: {
    label: "Transform 2D",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "UV", type: "vec2" }
    ],
    params: [
      { name: "translateX", type: "number", default: 0.0, label: "Translate X", step: 0.01 },
      { name: "translateY", type: "number", default: 0.0, label: "Translate Y", step: 0.01 },
      { name: "scaleX", type: "number", default: 1.0, label: "Scale X", step: 0.01, min: 0.01 },
      { name: "scaleY", type: "number", default: 1.0, label: "Scale Y", step: 0.01, min: 0.01 },
      { name: "rotation", type: "number", default: 0.0, label: "Rotation (rad)", step: 0.01 },
      { name: "centerX", type: "number", default: 0.5, label: "Center X", step: 0.01 },
      { name: "centerY", type: "number", default: 0.5, label: "Center Y", step: 0.01 }
    ],
  },

  Scale2D: {
    label: "Scale 2D",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "UV", type: "vec2" }
    ],
    params: [
      { name: "scaleX", type: "number", default: 1.0, label: "Scale X", step: 0.01, min: 0.01 },
      { name: "scaleY", type: "number", default: 1.0, label: "Scale Y", step: 0.01, min: 0.01 },
      { name: "centerX", type: "number", default: 0.5, label: "Center X", step: 0.01 },
      { name: "centerY", type: "number", default: 0.5, label: "Center Y", step: 0.01 }
    ],
  },

  Rotate2D: {
    label: "Rotate 2D",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "UV", type: "vec2" }
    ],
    params: [
      { name: "rotation", type: "number", default: 0.0, label: "Rotation (rad)", step: 0.01 },
      { name: "centerX", type: "number", default: 0.5, label: "Center X", step: 0.01 },
      { name: "centerY", type: "number", default: 0.5, label: "Center Y", step: 0.01 }
    ],
  },
UVToColor: {
  label: "UV to Color",
  cat: "Transform",
  inputs: 1,
  pinsIn: ["UV"],
  pinsOut: [
    { label: "RGB", type: "vec3" }
  ],
  params: []
},
  Translate2D: {
    label: "Translate 2D",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "UV", type: "vec2" }
    ],
    params: [
      { name: "translateX", type: "number", default: 0.0, label: "Translate X", step: 0.01 },
      { name: "translateY", type: "number", default: 0.0, label: "Translate Y", step: 0.01 }
    ],
  },

  TileAndOffset: {
    label: "Tile and Offset",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "UV", type: "vec2" }
    ],
    params: [
      { name: "tilingX", type: "number", default: 1.0, label: "Tiling X", step: 0.01, min: 0.01 },
      { name: "tilingY", type: "number", default: 1.0, label: "Tiling Y", step: 0.01, min: 0.01 },
      { name: "offsetX", type: "number", default: 0.0, label: "Offset X", step: 0.01 },
      { name: "offsetY", type: "number", default: 0.0, label: "Offset Y", step: 0.01 }
    ],
  },

  Flip2D: {
    label: "Flip 2D",
    cat: "Transform",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "UV", type: "vec2" }
    ],
    params: [
      { name: "flipX", type: "boolean", default: false, label: "Flip X" },
      { name: "flipY", type: "boolean", default: false, label: "Flip Y" }
    ],
  }
};