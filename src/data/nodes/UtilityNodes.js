// src/data/nodes/UtilityNodes.js

/**
 * Utility node definitions for data manipulation and conversion
 */
export const UtilityNodes = {
  Expr: {
    label: "Expression",
    cat: "Utility",
    inputs: 2,
    pinsIn: ["a", "b"],
    pinsOut: [{ label: "out", type: "f32" }],
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
    params: [
      {
        name: "select",
        type: "int",
        default: 0,
        min: 0,
        max: 3,
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

  CustomGLSL: {
    label: "Custom GLSL",
    cat: "Utility",
    inputs: 4,
    pinsIn: ["Input 0", "Input 1", "Input 2", "Input 3"],
    pinsOut: [{ label: "out", type: "f32" }],
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
