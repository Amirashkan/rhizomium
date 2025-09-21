// src/data/nodes/NoiseNodes.js
export const NoiseNodes = {
  Random: {
    label: "Random",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "seed", label: "Seed", type: "float", default: 1.0 },
      { name: "scale", label: "Scale", type: "float", default: 1.0 },
    ],
  },

  ValueNoise: {
    label: "Value Noise",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", label: "Scale", type: "float", default: 5.0 },
      { name: "amplitude", label: "Amplitude", type: "float", default: 1.0 },
      { name: "offset", label: "Offset", type: "float", default: 0.0 },
      { name: "power", label: "Power", type: "float", default: 1.0 },
    ],
  },

  FBMNoise: {
    label: "FBM Noise",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", label: "Scale", type: "float", default: 3.0 },
      { name: "octaves", label: "Octaves", type: "int", default: 4 },
      { name: "persistence", label: "Persistence", type: "float", default: 0.5 },
      { name: "lacunarity", label: "Lacunarity", type: "float", default: 2.0 },
      { name: "amplitude", label: "Amplitude", type: "float", default: 1.0 },
      { name: "offset", label: "Offset", type: "float", default: 0.0 },
      { name: "gain", label: "Gain", type: "float", default: 0.5 },
      { name: "warp", label: "Warp", type: "float", default: 0.0 },
    ],
  },

  SimplexNoise: {
    label: "Simplex Noise",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", label: "Scale", type: "float", default: 4.0 },
      { name: "amplitude", label: "Amplitude", type: "float", default: 1.0 },
      { name: "offset", label: "Offset", type: "float", default: 0.0 },
      { name: "ridge", label: "Ridge Mode", type: "bool", default: false },
      { name: "turbulence", label: "Turbulence", type: "bool", default: false },
    ],
  },

  VoronoiNoise: {
    label: "Voronoi Noise",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", label: "Scale", type: "float", default: 8.0 },
      { name: "randomness", label: "Randomness", type: "float", default: 1.0 },
      { name: "minkowskiP", label: "Distance Type", type: "float", default: 2.0 },
      { name: "smoothness", label: "Smoothness", type: "float", default: 0.0 },
      { name: "cellType", label: "Cell Type", type: "int", default: 0 },
      { name: "outputType", label: "Output Type", type: "int", default: 0 },
    ],
  },

  RidgedNoise: {
    label: "Ridged Noise",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", label: "Scale", type: "float", default: 4.0 },
      { name: "octaves", label: "Octaves", type: "int", default: 6 },
      { name: "lacunarity", label: "Lacunarity", type: "float", default: 2.0 },
      { name: "gain", label: "Gain", type: "float", default: 0.5 },
      { name: "amplitude", label: "Amplitude", type: "float", default: 1.0 },
      { name: "offset", label: "Offset", type: "float", default: 1.0 },
      { name: "threshold", label: "Threshold", type: "float", default: 0.0 },
    ],
  },

  WarpNoise: {
    label: "Warp Noise",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "scale", label: "Scale", type: "float", default: 3.0 },
      { name: "warpScale", label: "Warp Scale", type: "float", default: 2.0 },
      { name: "warpStrength", label: "Warp Strength", type: "float", default: 0.1 },
      { name: "octaves", label: "Octaves", type: "int", default: 3 },
      { name: "amplitude", label: "Amplitude", type: "float", default: 1.0 },
    ],
  },
};