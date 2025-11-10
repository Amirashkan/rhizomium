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
};
