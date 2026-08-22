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
      // Trim: play only part of the clip. Trim End 0 means "to the end", which is how a range can
      // be given before the file (and its duration) is known.
      {
        name: "trimStart",
        type: "float",
        default: 0.0,
        min: 0.0,
        max: 3600.0,
        label: "Trim Start (s)",
        activeWhen: { sourceType: "video" },
      },
      {
        name: "trimEnd",
        type: "float",
        default: 0.0,
        min: 0.0,
        max: 3600.0,
        label: "Trim End (s, 0 = end)",
        activeWhen: { sourceType: "video" },
      },
      // Rewind to the start of the clip (or of the trimmed span). Momentary, like the Feedback
      // nodes' Reset - but this one also takes an expression: whatever is typed in the field under
      // the button is evaluated every frame, and each rising edge past 0.5 rewinds the clip, so a
      // video can be re-cued by the beat ("=audioEnvelopeBass > 0.6") or by any node in the patch.
      // VideoResetProcessor watches it; the stored value is the expression, never a pressed state.
      {
        name: "reset",
        type: "button",
        action: "resetVideo",
        expressionable: true,
        expressionPlaceholder: "=audioEnvelopeBass > 0.6",
        label: "Reset",
        description: "Rewind to the start of the clip (or of the trim span)",
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