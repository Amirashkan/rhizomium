// src/data/nodes/FieldNodes.js

/**
 * Field and noise generation node definitions for procedural patterns
 */
export const FieldNodes = {
  // === GRADIENT PATTERNS ===
  LinearGradient: {
    label: "Linear Gradient",
    cat: "Field",
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
    cat: "Field",
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
    cat: "Field",
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
    cat: "Field",
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

  // === PATTERN GENERATORS ===
  Checker: {
    label: "Checker",
    cat: "Field",
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
    cat: "Field",
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
    cat: "Field",
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
    cat: "Field",
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
    cat: "Field",
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

  // === CELL-BASED PATTERNS ===
  Worley: {
    label: "Worley Noise",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "F1", type: "f32" },
      { label: "F2", type: "f32" },
      { label: "Combined", type: "f32" },
    ],
    params: [
      { name: "scale", type: "float", default: 8.0, label: "Scale" },
      { name: "jitter", type: "float", default: 1.0, label: "Jitter" },
      { 
        name: "distanceMetric", 
        type: "select",
        default: "euclidean",
        options: ["euclidean", "manhattan", "chebyshev", "minkowski"],
        label: "Distance Metric"
      },
      { name: "minkowskiP", type: "float", default: 2.0, label: "Minkowski P" },
    ],
  },

  CellNoise: {
    label: "Cell Noise",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "out", type: "f32" },
      { label: "cellID", type: "vec2" },
    ],
    params: [
      { name: "scale", type: "float", default: 8.0, label: "Scale" },
      { name: "randomness", type: "float", default: 1.0, label: "Randomness" },
      { name: "smooth", type: "bool", default: false, label: "Smooth" },
    ],
  },

  Displacement: {
    label: "Displacement",
    cat: "Field",
    inputs: 2,
    pinsIn: ["UV", "Offset"],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "strength", type: "float", default: 0.2, label: "Strength" },
      { name: "centered", type: "boolean", default: true, label: "Center Input" },
      { name: "wrap", type: "boolean", default: false, label: "Wrap UV" },
    ],
  },
};
