// src/data/nodes/FieldNodes.js
export const FieldNodes = {
  CircleField: {
    label: "Circle",
    cat: "Field",
    inputs: 2,
    pinsIn: ["R", "E"],
    pinsOut: [{ label: "f", type: "f32" }],
    params: [
      { name: "radius", type: "float", default: 0.25, label: "Radius" },
      { name: "epsilon", type: "float", default: 0.01, label: "Epsilon" },
    ],
  },
};