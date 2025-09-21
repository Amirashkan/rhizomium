// src/data/nodes/VectorNodes.js

/**
 * Vector operation node definitions for 3D math
 */
export const VectorNodes = {
  Dot: {
    label: "Dot Product",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "dot", type: "f32" }],
    params: [],
  },

  Cross: {
    label: "Cross Product",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "cross", type: "vec3" }],
    params: [],
  },

  Normalize: {
    label: "Normalize",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "norm", type: "vec3" }],
    params: [],
  },

  Length: {
    label: "Length",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "len", type: "f32" }],
    params: [],
  },

  Distance: {
    label: "Distance",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "dist", type: "f32" }],
    params: [],
  },

  Reflect: {
    label: "Reflect",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["I", "N"],
    pinsOut: [{ label: "refl", type: "vec3" }],
    params: [],
  },

  Refract: {
    label: "Refract",
    cat: "Vector",
    inputs: 3,
    pinsIn: ["I", "N", "eta"],
    pinsOut: [{ label: "refr", type: "vec3" }],
    params: [],
  },
};