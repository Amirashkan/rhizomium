// src/data/nodes/ColorNodes.js

/**
 * Color manipulation node definitions
 *
 * Note: Color adjustments (brightness, contrast, saturation) and HSV conversions
 * have been consolidated into ComputeColorAdjust and ComputeHSV nodes for better
 * performance and more comprehensive controls.
 */
export const ColorNodes = {
  ColorToGrayscale: {
    label: "To Grayscale",
    cat: "Modifiers",
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
    cat: "Modifiers",
    inputs: 1,
    pinsIn: ["Color"],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [],
  },

  ColorMix: {
    label: "Color Mix",
    cat: "Modifiers",
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
};
