// src/data/nodes/ColorNodes.js

/**
 * Color manipulation node definitions
 */
export const ColorNodes = {
  ColorToGrayscale: {
    label: "To Grayscale",
    cat: "Color",
    inputs: 1,
    pinsIn: ["Color"],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      {
        name: "method",
        type: "select",
        default: "luminance",
        options: ["luminance", "average", "lightness"],
        label: "Method"
      },
    ],
  },

  ColorInvert: {
    label: "Invert Color",
    cat: "Color",
    inputs: 1,
    pinsIn: ["Color"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  ColorSaturate: {
    label: "Saturate Color",
    cat: "Color",
    inputs: 1,
    pinsIn: ["Color"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "saturation", type: "float", default: 1.0, label: "Saturation" },
    ],
  },

  ColorContrast: {
    label: "Contrast",
    cat: "Color",
    inputs: 1,
    pinsIn: ["Color"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "contrast", type: "float", default: 1.0, label: "Contrast" },
      { name: "pivot", type: "float", default: 0.5, label: "Pivot" },
    ],
  },

  ColorBrightness: {
    label: "Brightness",
    cat: "Color",
    inputs: 1,
    pinsIn: ["Color"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "brightness", type: "float", default: 0.0, label: "Brightness" },
    ],
  },

  ColorMix: {
    label: "Color Mix",
    cat: "Color",
    inputs: 3,
    pinsIn: ["Base", "Blend", "Factor"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      {
        name: "mode",
        type: "select",
        default: "mix",
        options: [
          "mix",
          "multiply",
          "screen",
          "overlay",
          "add",
          "subtract",
          "divide",
          "difference",
          "darken",
          "lighten",
        ],
        label: "Mode",
      },
    ],
  },

  HSVToRGB: {
    label: "HSV to RGB",
    cat: "Color",
    inputs: 1,
    pinsIn: ["HSV"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  RGBToHSV: {
    label: "RGB to HSV",
    cat: "Color",
    inputs: 1,
    pinsIn: ["RGB"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },
};
