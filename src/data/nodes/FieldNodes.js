// src/data/nodes/FieldNodes.js

/**
 * Field node definitions for distance fields and geometric shapes
 */
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