// src/data/nodes/MathNodes.js

/**
 * Mathematical operation node definitions including scalar and vector math
 * Now type-aware: operations preserve input types (f32, vec2, vec3, vec4)
 */
export const MathNodes = {
  // === BASIC ARITHMETIC ===
  Add: {
    label: "Add",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }], // Type matches inputs
    params: [
      { name: "a", type: "float", default: 0.0, label: "A", inputSlot: 0 },
      { name: "b", type: "float", default: 0.0, label: "B", inputSlot: 1 }
    ],
  },

  Subtract: {
    label: "Subtract",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "a", type: "float", default: 0.0, label: "A", inputSlot: 0 },
      { name: "b", type: "float", default: 0.0, label: "B", inputSlot: 1 }
    ],
  },

  Multiply: {
    label: "Multiply",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "a", type: "float", default: 1.0, label: "A", inputSlot: 0 },
      { name: "b", type: "float", default: 1.0, label: "B", inputSlot: 1 }
    ],
  },

  Divide: {
    label: "Divide",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "a", type: "float", default: 1.0, label: "A", inputSlot: 0 },
      { name: "b", type: "float", default: 1.0, label: "B", inputSlot: 1 }
    ],
  },

  Power: {
    label: "Power",
    cat: "Math",
    inputs: 2,
    pinsIn: ["Base", "Exp"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "base", type: "float", default: 1.0, label: "Base", inputSlot: 0 },
      { name: "exp", type: "float", default: 2.0, label: "Exp", inputSlot: 1 }
    ],
  },

  // === TRIGONOMETRIC FUNCTIONS ===
  Sin: {
    label: "Sin",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Cos: {
    label: "Cos",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Tan: {
    label: "Tan",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Asin: {
    label: "Asin",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Acos: {
    label: "Acos",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Atan: {
    label: "Atan",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Atan2: {
    label: "Atan2",
    cat: "Math",
    inputs: 2,
    pinsIn: ["y", "x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  // === MATHEMATICAL FUNCTIONS ===
  Floor: {
    label: "Floor",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Ceil: {
    label: "Ceil",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Round: {
    label: "Round",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Fract: {
    label: "Fract",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Abs: {
    label: "Abs",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Sqrt: {
    label: "Sqrt",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Sign: {
    label: "Sign",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Mod: {
    label: "Mod",
    cat: "Math",
    inputs: 2,
    pinsIn: ["x", "y"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Exp: {
    label: "Exp",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Exp2: {
    label: "Exp2",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Log: {
    label: "Log",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Log2: {
    label: "Log2",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  // === RANGE AND COMPARISON ===
  Min: {
    label: "Min",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Max: {
    label: "Max",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Clamp: {
    label: "Clamp",
    cat: "Math",
    inputs: 3,
    pinsIn: ["Value", "Min", "Max"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  // === INTERPOLATION ===
  Smoothstep: {
    label: "Smoothstep",
    cat: "Math",
    inputs: 3,
    pinsIn: ["Edge0", "Edge1", "X"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Step: {
    label: "Step",
    cat: "Math",
    inputs: 2,
    pinsIn: ["Edge", "X"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Mix: {
    label: "Mix",
    cat: "Math",
    inputs: 3,
    pinsIn: ["A", "B", "T"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Lerp: {
    label: "Lerp",
    cat: "Math",
    inputs: 3,
    pinsIn: ["A", "B", "T"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  InverseLerp: {
    label: "Inverse Lerp",
    cat: "Math",
    inputs: 3,
    pinsIn: ["A", "B", "Value"],
    pinsOut: [{ label: "out", type: "f32" }], // Always returns scalar
    params: [],
  },

  Saturate: {
    label: "Saturate",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  OneMinus: {
    label: "One Minus",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Negate: {
    label: "Negate",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Reciprocal: {
    label: "Reciprocal",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  // === BOOLEAN LOGIC ===
  // Gates treat their inputs as booleans: a component is "true" when it is >= Threshold.
  // They output 0.0 / 1.0 (per component for vector inputs), so a gate can drive a mask,
  // a Mix factor, a Select condition or another gate.
  And: {
    label: "AND",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
    ],
  },

  Or: {
    label: "OR",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
    ],
  },

  Xor: {
    label: "XOR",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
    ],
  },

  Not: {
    label: "NOT",
    cat: "Math",
    inputs: 1,
    pinsIn: ["x"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
    ],
  },

  Nand: {
    label: "NAND",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
    ],
  },

  Nor: {
    label: "NOR",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
    ],
  },

  Xnor: {
    label: "XNOR",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
    ],
  },

  // === VECTOR MATH OPERATIONS ===
  Dot: {
    label: "Dot Product",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }], // Always returns scalar
    params: [],
  },

  Cross: {
    label: "Cross Product",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }], // Always vec3
    params: [],
  },

  Normalize: {
    label: "Normalize",
    cat: "Math",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Length: {
    label: "Length",
    cat: "Math",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "out", type: "f32" }], // Always returns scalar
    params: [],
  },

  Distance: {
    label: "Distance",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }], // Always returns scalar
    params: [],
  },

  Reflect: {
    label: "Reflect",
    cat: "Math",
    inputs: 2,
    pinsIn: ["I", "N"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },

  Refract: {
    label: "Refract",
    cat: "Math",
    inputs: 3,
    pinsIn: ["I", "N", "eta"],
    pinsOut: [{ label: "out", type: "dynamic" }],
    params: [],
  },
};