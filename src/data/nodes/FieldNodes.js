export const FieldNodes = {
  CircleField: {
    label: "Circle",
    cat: "Field", 
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "f", type: "f32" }],
    params: [
      { name: "radius", type: "float", default: 0.25, label: "Radius" },
      { name: "epsilon", type: "float", default: 0.01, label: "Epsilon" },
    ],
  },

  RectField: {
    label: "Rectangle",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "f", type: "f32" }],
    params: [
      { name: "width", type: "float", default: 0.5, label: "Width" },
      { name: "height", type: "float", default: 0.3, label: "Height" },
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
      { name: "epsilon", type: "float", default: 0.02, label: "Epsilon" },
    ],
  },
};
