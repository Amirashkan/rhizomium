// src/data/nodes/InputNodes.js
export const InputNodes = {
  OutputFinal: {
    label: "Output",
    cat: "Output",
    inputs: 1,
    pinsIn: ["color"],
    pinsOut: [],
    params: [],
  },

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
};