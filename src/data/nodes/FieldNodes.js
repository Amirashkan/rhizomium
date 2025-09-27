/**
 * Field node definitions for distance fields and geometric shapes
 */
export const FieldNodes = {
CircleField: {
  label: "Circle",
  cat: "Field",
  inputs: 0,  // ← No input pins
  // Remove pinsIn entirely
  pinsOut: [{ label: "f", type: "f32" }],
  params: [
    { name: "radius", type: "float", default: 0.25, label: "Radius" },
    { name: "epsilon", type: "float", default: 0.01, label: "Epsilon" },
  ],
},
  RectField: {
    label: "Rectangle",
    cat: "Field",
    inputs: 3,
    pinsIn: ["W", "H", "E"],
    pinsOut: [{ label: "f", type: "f32" }],
    params: [
      { name: "width", type: "float", default: 0.5, label: "Width" },
      { name: "height", type: "float", default: 0.5, label: "Height" },
      { name: "epsilon", type: "float", default: 0.01, label: "Epsilon" },
    ],
  },
};