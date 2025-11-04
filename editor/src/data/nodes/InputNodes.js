// src/data/nodes/InputNodes.js

/**
 * Input node definitions for constants, data sources, and textures
 */
export const InputNodes = {
  // === CONSTANT VALUES ===
  ConstFloat: {
    label: "Float",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { name: "value", type: "float", default: 0.0, label: "Value" }
    ],
  },

  ConstVec2: {
    label: "Vec2",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "x", type: "float", default: 0.0, label: "X" },
      { name: "y", type: "float", default: 0.0, label: "Y" },
    ],
  },

  ConstVec3: {
    label: "Vec3",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "x", type: "float", default: 0.0, label: "X" },
      { name: "y", type: "float", default: 0.0, label: "Y" },
      { name: "z", type: "float", default: 0.0, label: "Z" },
    ],
  },

  ConstVec4: {
    label: "Vec4",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "vec4" }],
    params: [
      { name: "x", type: "float", default: 0.0, label: "X" },
      { name: "y", type: "float", default: 0.0, label: "Y" },
      { name: "z", type: "float", default: 0.0, label: "Z" },
      { name: "w", type: "float", default: 1.0, label: "W" },
    ],
  },

  // === RUNTIME INPUTS ===
  UV: {
    label: "UV",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "uv", type: "vec2" }],
    params: [],
  },

  Time: {
    label: "Time",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "t", type: "f32" }],
    params: [],
  },

  Mouse: {
    label: "Mouse",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [
      { label: "pos", type: "vec2" },
      { label: "x", type: "f32" },
      { label: "y", type: "f32" },
    ],
    params: [],
  },

  Resolution: {
    label: "Resolution",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [
      { label: "res", type: "vec2" },
      { label: "width", type: "f32" },
      { label: "height", type: "f32" },
      { label: "aspect", type: "f32" },
    ],
    params: [],
  },

  Pi: {
    label: "Pi",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "pi", type: "f32" }],
    params: [],
  },

  Random: {
    label: "Random",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "rand", type: "f32" }],
    params: [],
  },

  // === TEXTURE SAMPLING ===
  Texture2D: {
    label: "Texture 2D",
    cat: "Input",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "RGBA", type: "vec4" },
      { label: "RGB", type: "vec3" },
      { label: "R", type: "f32" },
      { label: "G", type: "f32" },
      { label: "B", type: "f32" },
      { label: "A", type: "f32" },
    ],
    params: [
      { name: "imageFile", type: "file", accept: "image/*", label: "Image" },
      {
        name: "wrapU",
        type: "select",
        options: ["repeat", "clamp", "mirror"],
        default: "repeat",
        label: "Wrap U",
      },
      {
        name: "wrapV",
        type: "select",
        options: ["repeat", "clamp", "mirror"],
        default: "repeat",
        label: "Wrap V",
      },
      {
        name: "filter",
        type: "select",
        options: ["linear", "nearest"],
        default: "linear",
        label: "Filter",
      },
    ],
  },

  TextureCube: {
    label: "Texture Cube",
    cat: "Input",
    inputs: 1,
    pinsIn: ["Dir"],
    pinsOut: [
      { label: "RGBA", type: "vec4" },
      { label: "RGB", type: "vec3" },
      { label: "A", type: "f32" },
    ],
    params: [
      { name: "imageFile", type: "file", accept: "image/*", label: "Cubemap" },
      {
        name: "filter",
        type: "select",
        options: ["linear", "nearest"],
        default: "linear",
        label: "Filter",
      },
    ],
  },
};