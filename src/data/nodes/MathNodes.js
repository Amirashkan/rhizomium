// src/data/nodes/MathNodes.js

/**
 * Mathematical operation node definitions including scalar and vector math
 */
export const MathNodes = {
  // === BASIC ARITHMETIC ===
  Add: {
    label: "Add",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Subtract: {
    label: "Subtract",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Multiply: {
    label: "Multiply",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Divide: {
    label: "Divide",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Power: {
    label: "Power",
    cat: "Math",
    inputs: 2,
    pinsIn: ["Base", "Exp"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  // === TRIGONOMETRIC FUNCTIONS ===
  Sin: {
    label: "Sin",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Cos: {
    label: "Cos",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Tan: {
    label: "Tan",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Asin: {
    label: "Asin",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Acos: {
    label: "Acos",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Atan: {
    label: "Atan",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Atan2: {
    label: "Atan2",
    cat: "Math",
    inputs: 2,
    pinsIn: ["y", "x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  // === MATHEMATICAL FUNCTIONS ===
  Floor: {
    label: "Floor",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Ceil: {
    label: "Ceil",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Round: {
    label: "Round",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Fract: {
    label: "Fract",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Abs: {
    label: "Abs",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Sqrt: {
    label: "Sqrt",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Sign: {
    label: "Sign",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Mod: {
    label: "Mod",
    cat: "Math",
    inputs: 2,
    pinsIn: ["x", "y"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Exp: {
    label: "Exp",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Exp2: {
    label: "Exp2",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Log: {
    label: "Log",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Log2: {
    label: "Log2",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  // === RANGE AND COMPARISON ===
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

  // === INTERPOLATION ===
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
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Lerp: {
    label: "Lerp",
    cat: "Math",
    inputs: 3,
    pinsIn: ["A", "B", "T"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  InverseLerp: {
    label: "Inverse Lerp",
    cat: "Math",
    inputs: 3,
    pinsIn: ["A", "B", "Value"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Saturate: {
    label: "Saturate",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  OneMinus: {
    label: "One Minus",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Negate: {
    label: "Negate",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Reciprocal: {
    label: "Reciprocal",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  // === VECTOR MATH OPERATIONS ===
  Dot: {
    label: "Dot Product",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Cross: {
    label: "Cross Product",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  Normalize: {
    label: "Normalize",
    cat: "Math",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  Length: {
    label: "Length",
    cat: "Math",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Distance: {
    label: "Distance",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },

  Reflect: {
    label: "Reflect",
    cat: "Math",
    inputs: 2,
    pinsIn: ["I", "N"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  Refract: {
    label: "Refract",
    cat: "Math",
    inputs: 3,
    pinsIn: ["I", "N", "eta"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  // === VECTOR ARITHMETIC ===
  VectorAdd: {
    label: "Vector Add",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  VectorSubtract: {
    label: "Vector Subtract",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  VectorMultiply: {
    label: "Vector Multiply",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  VectorDivide: {
    label: "Vector Divide",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  VectorScale: {
    label: "Vector Scale",
    cat: "Math",
    inputs: 2,
    pinsIn: ["Vec", "Scale"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },
};