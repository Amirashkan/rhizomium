let _nextId = 1;
// src/data/NodeDefs.js
export const NodeDefs = {
  OutputFinal: {
    label: "Output",
    cat: "Output",
    inputs: 1,
    pinsIn: ["color"],
    pinsOut: [],
    params: [],
  },

  // Input Nodes
  ConstFloat: {
    label: "Float",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "v", type: "f32" }],
    params: [{ name: "value", type: "float", default: 0.0, label: "Value" }],
  },
  ConstVec2: {
    label: "Vec2",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "v", type: "vec2" }],
    params: [
      { name: "x", type: "float", default: 0.0, label: "X" },
      { name: "y", type: "float", default: 0.0, label: "Y" },
    ],
  },
  ConstVec3: {
    label: "Vec3",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "v", type: "vec3" }],
    params: [
      { name: "x", type: "float", default: 0.0, label: "X" },
      { name: "y", type: "float", default: 0.0, label: "Y" },
      { name: "z", type: "float", default: 0.0, label: "Z" },
    ],
  },
  UV: {
    label: "UV",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "uv", type: "vec2" }],
    params: [],
  },
  Time: {
    label: "Time",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "t", type: "f32" }],
    params: [],
  },

  // Field Nodes
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

  // Basic Math Operations
  Multiply: {
    label: "Multiply",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "v", type: "vec3" }],
    params: [],
  },
  Add: {
    label: "Add",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "v", type: "vec3" }],
    params: [],
  },
  Subtract: {
    label: "Subtract",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },
  Divide: {
    label: "Divide",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  // Math Functions
  Sin: {
    label: "Sin",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Cos: {
    label: "Cos",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Tan: {
    label: "Tan",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Floor: {
    label: "Floor",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Fract: {
    label: "Fract",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Abs: {
    label: "Abs",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Sqrt: {
    label: "Sqrt",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Pow: {
    label: "Power",
    cat: "Math",
    inputs: 2,
    pinsIn: ["Base", "Exp"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Min: {
    label: "Min",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Max: {
    label: "Max",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Clamp: {
    label: "Clamp",
    cat: "Math",
    inputs: 3,
    pinsIn: ["Value", "Min", "Max"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Smoothstep: {
    label: "Smoothstep",
    cat: "Math",
    inputs: 3,
    pinsIn: ["Edge0", "Edge1", "X"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Step: {
    label: "Step",
    cat: "Math",
    inputs: 2,
    pinsIn: ["Edge", "X"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Mix: {
    label: "Mix",
    cat: "Math",
    inputs: 3,
    pinsIn: ["A", "B", "T"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },
  Sign: {
    label: "Sign",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Mod: {
    label: "Mod",
    cat: "Math",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [],
  },
  Saturate: {
    label: "Saturate",
    cat: "Math",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [{ label: "v", type: "vec3" }],
    params: [],
  },

  // Vector Operations (NO DUPLICATES)
  Dot: {
    label: "Dot Product",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "dot", type: "f32" }],
    params: [],
  },
  Cross: {
    label: "Cross Product",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "cross", type: "vec3" }],
    params: [],
  },
  Normalize: {
    label: "Normalize",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "norm", type: "vec3" }],
    params: [],
  },
  Length: {
    label: "Length",
    cat: "Vector",
    inputs: 1,
    pinsIn: ["Vec"],
    pinsOut: [{ label: "len", type: "f32" }],
    params: [],
  },
  Distance: {
    label: "Distance",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["A", "B"],
    pinsOut: [{ label: "dist", type: "f32" }],
    params: [],
  },
  Reflect: {
    label: "Reflect",
    cat: "Vector",
    inputs: 2,
    pinsIn: ["I", "N"],
    pinsOut: [{ label: "refl", type: "vec3" }],
    params: [],
  },
  Refract: {
    label: "Refract",
    cat: "Vector",
    inputs: 3,
    pinsIn: ["I", "N", "eta"],
    pinsOut: [{ label: "refr", type: "vec3" }],
    params: [],
  },

  // Utility Nodes
  Expr: {
    label: "Expr",
    cat: "Utility",
    inputs: 2,
    pinsIn: ["a", "b"],
    pinsOut: [{ label: "f", type: "f32" }],
    params: [
      { name: "expr", type: "expression", default: "a", label: "Expression" },
    ],
  },
  Split3: {
    label: "Split3",
    cat: "Utility",
    inputs: 1,
    pinsIn: ["In"],
    pinsOut: [
      { label: "x", type: "f32" },
      { label: "y", type: "f32" },
      { label: "z", type: "f32" },
    ],
    params: [],
  },
  Combine3: {
    label: "Combine3",
    cat: "Utility",
    inputs: 3,
    pinsIn: ["X", "Y", "Z"],
    pinsOut: [{ label: "v", type: "vec3" }],
    params: [],
  },

  // Noise Nodes
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
      {
        name: "persistence",
        label: "Persistence",
        type: "float",
        default: 0.5,
      },
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
      {
        name: "minkowskiP",
        label: "Distance Type",
        type: "float",
        default: 2.0,
      },
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
      {
        name: "warpStrength",
        label: "Warp Strength",
        type: "float",
        default: 0.1,
      },
      { name: "octaves", label: "Octaves", type: "int", default: 3 },
      { name: "amplitude", label: "Amplitude", type: "float", default: 1.0 },
    ],
  },

  Texture2D: {
    label: "Texture 2D",
    cat: "Texture",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "RGBA", type: "vec4" },
      { label: "RGB", type: "vec3" },
      { label: "A", type: "f32" },
    ],
    params: [
      { name: "imageFile", type: "file", accept: "image/*", label: "Image" },
      {
        name: "wrapU",
        type: "select",
        options: ["repeat", "clamp", "mirror"],
        default: "repeat",
        label: "Wrap U",
      },
      {
        name: "wrapV",
        type: "select",
        options: ["repeat", "clamp", "mirror"],
        default: "repeat",
        label: "Wrap V",
      },
      {
        name: "filter",
        type: "select",
        options: ["linear", "nearest"],
        default: "linear",
        label: "Filter",
      },
    ],
  },

  TextureCube: {
    label: "Texture Cube",
    cat: "Texture",
    inputs: 1,
    pinsIn: ["Dir"],
    pinsOut: [
      { label: "RGBA", type: "vec4" },
      { label: "RGB", type: "vec3" },
      { label: "A", type: "f32" },
    ],
    params: [
      { name: "imageFile", type: "file", accept: "image/*", label: "Cubemap" },
      {
        name: "filter",
        type: "select",
        options: ["linear", "nearest"],
        default: "linear",
        label: "Filter",
      },
    ],
  },
};

export function makeNode(kind, x = 0, y = 0) {
  const def = NodeDefs[kind];
  if (!def) throw new Error(`Unknown node kind: ${kind}`);

  const node = {
    id: String(_nextId++),
    kind,
    x,
    y,
    w: 180,
    h: Math.max(60, 40 + (def.inputs || 0) * 18),
    inputs: new Array(def.inputs).fill(null),
    params: {},
    expr: def.params?.find((p) => p.name === "expr") ? "a" : undefined,
    value: def.params?.find((p) => p.name === "value")?.default ?? undefined,
  };

  // Initialize all parameter defaults
  if (def.params) {
    for (const param of def.params) {
      if (param.name === "value") {
        node.value = param.default;
      } else if (param.name === "x") {
        node.x = param.default;
      } else if (param.name === "y") {
        node.y = param.default;
      } else if (param.name === "expr") {
        node.expr = param.default;
      } else {
        if (!node.props) node.props = {};
        node.props[param.name] = param.default;
      }
    }
  }

  return node;
}
