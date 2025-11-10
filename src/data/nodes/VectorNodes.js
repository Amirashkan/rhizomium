// src/data/nodes/VectorNodes.js

/**
 * Vector construction/deconstruction node definitions
 */
export const VectorNodes = {
  // === VECTOR COMPONENT OPERATIONS ===
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

  // === SWIZZLE OPERATIONS ===
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