// src/data/nodes/TextureNodes.js
export const TextureNodes = {
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