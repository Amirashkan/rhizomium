// src/data/nodes/PatternNodes.js

/**
 * Pattern node definitions for gradients, shapes, and procedural patterns
 *
 * Note: Basic patterns (checker, stripes) and common gradients (linear, radial, angular)
 * have been consolidated into ComputePattern and ComputeGradient nodes for better
 * performance and flexibility.
 */
export const PatternNodes = {
  // === GRADIENT PATTERNS ===
  // ConicGradient and ColorRamp were removed: the GPU "Gradient" node (ComputeGradient)
  // covers both — its Angular type is a conic gradient, and wiring a value/mask into its
  // "Value" input drives the color stops the way Color Ramp used to (and it updates live).

  // === SHAPE GENERATORS ===
  Circle: {
    label: "Circle",
    cat: "Generators",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
      { name: "radius", type: "float", default: 0.25, label: "Radius" },
      { name: "smoothness", type: "float", default: 0.01, label: "Smoothness" },
      { name: "invert", type: "bool", default: false, label: "Invert" },
    ],
  },

  Rectangle: {
    label: "Rectangle",
    cat: "Generators",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
      { name: "width", type: "float", default: 0.5, label: "Width" },
      { name: "height", type: "float", default: 0.5, label: "Height" },
      {
        name: "sizeMode",
        type: "select",
        options: ["Frame", "Proportional"],
        default: "Frame",
        label: "Size Mode",
        description:
          "Frame: Width and Height are fractions of the frame's width and height, so 1 x 1 fills " +
          "the composition and the shape takes its ratio. Proportional: both are measured against " +
          "the frame's height, so Width : Height is the shape's real ratio and equal values draw a square.",
      },
      { name: "roundness", type: "float", default: 0.0, label: "Roundness" },
      { name: "smoothness", type: "float", default: 0.01, label: "Smoothness" },
      { name: "invert", type: "bool", default: false, label: "Invert" },
    ],
  },

  Polygon: {
    label: "Polygon",
    cat: "Generators",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { name: "centerX", type: "float", default: 0.5, label: "Center X" },
      { name: "centerY", type: "float", default: 0.5, label: "Center Y" },
      { name: "sides", type: "int", default: 6, label: "Sides" },
      { name: "radius", type: "float", default: 0.25, label: "Radius" },
      { name: "rotation", type: "float", default: 0.0, label: "Rotation" },
      { name: "smoothness", type: "float", default: 0.01, label: "Smoothness" },
      { name: "invert", type: "bool", default: false, label: "Invert" },
    ],
  },
};
