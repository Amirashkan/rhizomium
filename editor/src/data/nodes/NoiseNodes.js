// src/data/nodes/NoiseNodes.js

/**
 * Noise generation node definitions for procedural textures
 */
export const NoiseNodes = {
  Random: {
    label: "Random",
    cat: "Noise",
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
    cat: "Noise",
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
    cat: "Noise",
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
    cat: "Noise",
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
    cat: "Noise",
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
    cat: "Noise",
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
    cat: "Noise",
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
    cat: "Noise",
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
};