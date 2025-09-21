// src/data/nodes/UtilityNodes.js
export const UtilityNodes = {
  Expr: {
    label: "Expr",
    cat: "Utility",
    inputs: 2,
    pinsIn: ["a", "b"],
    pinsOut: [{ label: "f", type: "f32" }],
    params: [
      { name: "expr", type: "expression", default: "a", label: "Expression" },
    ],
  },

  Split3: {
    label: "Split3",
    cat: "Utility",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [
      { label: "x", type: "f32" },
      { label: "y", type: "f32" },
      { label: "z", type: "f32" },
    ],
    params: [],
  },

  Combine3: {
    label: "Combine3",
    cat: "Utility",
    inputs: 3,
    pinsIn: ["X", "Y", "Z"],
    pinsOut: [{ label: "v", type: "vec3" }],
    params: [],
  },
};