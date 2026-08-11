// src/data/nodes/TextureNodes.js

/**
 * Texture sampling node definitions for image processing
 */
export const TextureNodes = {
  Texture2D: {
    label: "Texture 2D",
    cat: "Texture",
    inputs: 1,
    pinsIn: ["UV"],
    // Single Color output. Use a Split Vec4 node to extract R/G/B/A channels.
    pinsOut: [{ label: "Color", type: "vec4" }],
    params: [
      {
        name: "imageFile",
        type: "file",
        accept: "image/*,video/*",
        label: "Image / Video",
      },
      // Set by the upload, not by hand: which of the two kinds of file this node is holding.
      // It is declared so the playback controls below can dim themselves for a still image, and
      // it rides along in the saved patch so a reopened project shows the right ones live.
      {
        name: "sourceType",
        type: "select",
        options: ["image", "video"],
        default: "image",
        hidden: true,
        label: "Source Type",
      },
      // Playback controls. They only mean anything once the loaded file is a video.
      {
        name: "playing",
        type: "bool",
        default: true,
        label: "Play",
        activeWhen: { sourceType: "video" },
      },
      {
        name: "loop",
        type: "bool",
        default: true,
        label: "Loop",
        activeWhen: { sourceType: "video" },
      },
      {
        name: "playbackRate",
        type: "float",
        default: 1.0,
        min: 0.0625,
        max: 16.0,
        label: "Speed",
        activeWhen: { sourceType: "video" },
      },
      {
        name: "sound",
        type: "bool",
        default: false,
        label: "Sound",
        activeWhen: { sourceType: "video" },
      },
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
    // Single Color output. Use a Split Vec4 node to extract R/G/B/A channels.
    pinsOut: [{ label: "Color", type: "vec4" }],
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