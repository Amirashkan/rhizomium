// src/data/nodes/MathNodes.js

/**
 * Mathematical operation node definitions
 */
export const MathNodes = {
  // Basic Arithmetic Operations
  Add: {
    label: "Add",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "v", type: "vec3" }],
    params: [],
  },

  Subtract: {
    label: "Subtract",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  Multiply: {
    label: "Multiply",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "v", type: "vec3" }],
    params: [],
  },

  Divide: {
    label: "Divide",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  // Trigonometric Functions
  Sin: {
    label: "Sin",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Cos: {
    label: "Cos",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Tan: {
    label: "Tan",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  // Mathematical Functions
  Floor: {
    label: "Floor",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Fract: {
    label: "Fract",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Abs: {
    label: "Abs",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Sqrt: {
    label: "Sqrt",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Pow: {
    label: "Power",
    cat: "Math",
    inputs: 2,
    pinsIn: ["Base", "Exp"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Sign: {
    label: "Sign",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Mod: {
    label: "Mod",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  // Range and Comparison Functions
  Min: {
    label: "Min",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Max: {
    label: "Max",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Clamp: {
    label: "Clamp",
    cat: "Math",
    inputs: 3,
    pinsIn: ["Value", "Min", "Max"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  // Interpolation Functions
  Smoothstep: {
    label: "Smoothstep",
    cat: "Math",
    inputs: 3,
    pinsIn: ["Edge0", "Edge1", "X"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Step: {
    label: "Step",
    cat: "Math",
    inputs: 2,
    pinsIn: ["Edge", "X"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Mix: {
    label: "Mix",
    cat: "Math",
    inputs: 3,
    pinsIn: ["A", "B", "T"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  Saturate: {
    label: "Saturate",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "v", type: "vec3" }],
    params: [],
  },
};