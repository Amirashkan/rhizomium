// src/data/nodes/PatternNodes.js

/**
 * Pattern node definitions for gradients, shapes, and procedural patterns
 */
export const PatternNodes = {
  // === GRADIENT PATTERNS ===
  LinearGradient: {
    label: "Linear Gradient",
    cat: "Pattern",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: ["Value"],
    params: [
      { name: 'angle', type: 'float', default: 0.0 },
      { name: 'offset', type: 'float', default: 0.0 },
      { name: 'scale', type: 'float', default: 1.0 },
      { name: 'repeat', type: 'boolean', default: false }
    ]
  },

  RadialGradient: {
    label: "Radial Gradient",
    cat: "Pattern",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: ["Value"],
    params: [
      { name: 'centerX', type: 'float', default: 0.5 },
      { name: 'centerY', type: 'float', default: 0.5 },
      { name: 'radius', type: 'float', default: 0.5 },
      { name: 'falloff', type: 'float', default: 1.0 },
      { name: 'invert', type: 'boolean', default: false }
    ]
  },

  AngularGradient: {
    label: "Angular Gradient",
    cat: "Pattern",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: ["Value"],
    params: [
      { name: 'centerX', type: 'float', default: 0.5 },
      { name: 'centerY', type: 'float', default: 0.5 },
      { name: 'rotation', type: 'float', default: 0.0 },
      { name: 'repeat', type: 'float', default: 1.0 }
    ]
  },

  ConicGradient: {
    label: "Conic Gradient",
    cat: "Pattern",
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
    cat: "Pattern",
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

  // === REPEATING PATTERNS ===
  Checker: {
    label: "Checker",
    cat: "Pattern",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { name: "scaleX", type: "float", default: 8.0, label: "Scale X" },
      { name: "scaleY", type: "float", default: 8.0, label: "Scale Y" },
      { name: "smoothness", type: "float", default: 0.0, label: "Smoothness" },
    ],
  },

  Stripe: {
    label: "Stripe",
    cat: "Pattern",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { name: "frequency", type: "float", default: 5.0, label: "Frequency" },
      { name: "angle", type: "float", default: 0.0, label: "Angle" },
      { name: "thickness", type: "float", default: 0.5, label: "Thickness" },
      { name: "smoothness", type: "float", default: 0.0, label: "Smoothness" },
    ],
  },

  // === SHAPE GENERATORS ===
  Circle: {
    label: "Circle",
    cat: "Pattern",
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
    cat: "Pattern",
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
    cat: "Pattern",
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
