// src/data/nodes/VectorNodes.js

/**
 * Vector operation node definitions for 2D/3D math
 */
export const VectorNodes = {
  // Vector Math Operations
  Dot: {
    label: "Dot Product",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Cross: {
    label: "Cross Product",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  Normalize: {
    label: "Normalize",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  Length: {
    label: "Length",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Distance: {
    label: "Distance",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Reflect: {
    label: "Reflect",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["I", "N"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  Refract: {
    label: "Refract",
    cat: "Vector",
    inputs: 3,
    pinsIn: ["I", "N", "eta"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  // Vector Component Operations
  Split2: {
    label: "Split Vec2",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [
      { label: "x", type: "f32" },
      { label: "y", type: "f32" },
    ],
    params: [],
  },

  Split3: {
    label: "Split Vec3",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [
      { label: "x", type: "f32" },
      { label: "y", type: "f32" },
      { label: "z", type: "f32" },
    ],
    params: [],
  },

  Split4: {
    label: "Split Vec4",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [
      { label: "x", type: "f32" },
      { label: "y", type: "f32" },
      { label: "z", type: "f32" },
      { label: "w", type: "f32" },
    ],
    params: [],
  },

  Combine2: {
    label: "Combine Vec2",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["X", "Y"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [],
  },

  Combine3: {
    label: "Combine Vec3",
    cat: "Vector",
    inputs: 3,
    pinsIn: ["X", "Y", "Z"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  Combine4: {
    label: "Combine Vec4",
    cat: "Vector",
    inputs: 4,
    pinsIn: ["X", "Y", "Z", "W"],
    pinsOut: [{ label: "out", type: "vec4" }],
    params: [],
  },

  // Vector Arithmetic
  VectorAdd: {
    label: "Vector Add",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  VectorSubtract: {
    label: "Vector Subtract",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  VectorMultiply: {
    label: "Vector Multiply",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  VectorDivide: {
    label: "Vector Divide",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  VectorScale: {
    label: "Vector Scale",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["Vec", "Scale"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  // Swizzle operations
  Swizzle: {
    label: "Swizzle",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { 
        name: "pattern", 
        type: "select", 
        default: "xyz",
        options: ["xyz", "xzy", "yxz", "yzx", "zxy", "zyx", "xxx", "yyy", "zzz"],
        label: "Pattern" 
      },
    ],
  },
};