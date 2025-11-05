// src/data/nodes/FieldNodes.js

/**
 * Field and noise generation node definitions for procedural patterns
 */
export const FieldNodes = {
   ColorRamp: {
    label: "Color Ramp",
    cat: "Field",
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

  ColorRamp: {
    label: "Color Ramp",
    cat: "Field",
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

  // === NOISE FUNCTIONS ===
  Random: {
    label: "Random",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "seed", type: "float", default: 1.0, label: "Seed" },
      { name: "scale", type: "float", default: 1.0, label: "Scale" },
    ],
  },

  ValueNoise: {
    label: "Value Noise",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", type: "float", default: 5.0, label: "Scale" },
      { name: "amplitude", type: "float", default: 1.0, label: "Amplitude" },
      { name: "offset", type: "float", default: 0.0, label: "Offset" },
      { name: "power", type: "float", default: 1.0, label: "Power" },
    ],
  },

  PerlinNoise: {
    label: "Perlin Noise",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", type: "float", default: 5.0, label: "Scale" },
      { name: "amplitude", type: "float", default: 1.0, label: "Amplitude" },
      { name: "offset", type: "float", default: 0.0, label: "Offset" },
    ],
  },

  SimplexNoise: {
    label: "Simplex Noise",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", type: "float", default: 4.0, label: "Scale" },
      { name: "amplitude", type: "float", default: 1.0, label: "Amplitude" },
      { name: "offset", type: "float", default: 0.0, label: "Offset" },
      { name: "ridge", type: "bool", default: false, label: "Ridge Mode" },
      { name: "turbulence", type: "bool", default: false, label: "Turbulence" },
    ],
  },

  FBMNoise: {
    label: "FBM Noise",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", type: "float", default: 3.0, label: "Scale" },
      { name: "octaves", type: "int", default: 4, label: "Octaves" },
      { name: "persistence", type: "float", default: 0.5, label: "Persistence" },
      { name: "lacunarity", type: "float", default: 2.0, label: "Lacunarity" },
      { name: "amplitude", type: "float", default: 1.0, label: "Amplitude" },
      { name: "offset", type: "float", default: 0.0, label: "Offset" },
      { name: "gain", type: "float", default: 0.5, label: "Gain" },
      { name: "warp", type: "float", default: 0.0, label: "Warp" },
    ],
  },

  VoronoiNoise: {
    label: "Voronoi Noise",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "F1", type: "f32" },
      { label: "F2", type: "f32" },
      { label: "cells", type: "vec2" },
    ],
    params: [
      { name: "scale", type: "float", default: 8.0, label: "Scale" },
      { name: "randomness", type: "float", default: 1.0, label: "Randomness" },
      { name: "minkowskiP", type: "float", default: 2.0, label: "Distance Type" },
      { name: "smoothness", type: "float", default: 0.0, label: "Smoothness" },
      { name: "cellType", type: "int", default: 0, label: "Cell Type" },
      { name: "outputType", type: "int", default: 0, label: "Output Type" },
    ],
  },

  RidgedNoise: {
    label: "Ridged Noise",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", type: "float", default: 4.0, label: "Scale" },
      { name: "octaves", type: "int", default: 6, label: "Octaves" },
      { name: "lacunarity", type: "float", default: 2.0, label: "Lacunarity" },
      { name: "gain", type: "float", default: 0.5, label: "Gain" },
      { name: "amplitude", type: "float", default: 1.0, label: "Amplitude" },
      { name: "offset", type: "float", default: 1.0, label: "Offset" },
      { name: "threshold", type: "float", default: 0.0, label: "Threshold" },
    ],
  },

  WarpNoise: {
    label: "Warp Noise",
    cat: "Field",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", type: "float", default: 3.0, label: "Scale" },
      { name: "warpScale", type: "float", default: 2.0, label: "Warp Scale" },
      { name: "warpStrength", type: "float", default: 0.1, label: "Warp Strength" },
      { name: "octaves", type: "int", default: 3, label: "Octaves" },
      { name: "amplitude", type: "float", default: 1.0, label: "Amplitude" },
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
  ColorRamp: {
  label: "Color Ramp",
  cat: "Field",
  inputs: 1,
  pinsIn: ["Value"],
  pinsOut: ["Color"],
  params: [
    { name: "stops", type: "colorstops", default: [
      { position: 0.0, color: [0, 0, 0, 1] },
      { position: 1.0, color: [1, 1, 1, 1] }
    ]},
    { name: "mode", type: "select", options: ["Linear", "Step", "Smooth"], default: "Linear" }
  ]
}
};
