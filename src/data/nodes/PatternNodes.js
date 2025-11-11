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
  ConicGradient: {
    label: "Conic Gradient",
    cat: "Generators",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: ["Value"],
    params: [
      { name: 'centerX', type: 'float', default: 0.5 },
      { name: 'centerY', type: 'float', default: 0.5 },
      { name: 'startAngle', type: 'float', default: 0.0 },
      { name: 'endAngle', type: 'float', default: 6.28318 },
      { name: 'smoothness', type: 'float', default: 0.0 }
    ]
  },

  ColorRamp: {
    label: "Color Ramp",
    cat: "Generators",
    inputs: 1,
    pinsIn: ["Value"],
    pinsOut: ["Color"],
    params: [
      {
        name: "stops",
        type: "colorstops",
        default: [
          { position: 0.0, color: [0, 0, 0, 1] },
          { position: 1.0, color: [1, 1, 1, 1] }
        ]
      },
      {
        name: "mode",
        type: "select",
        options: ["Linear", "Step", "Smooth"],
        default: "Linear"
      }
    ]
  },

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
