// src/data/nodes/TextNodes.js

/**
 * Text generator node definition.
 *
 * The node rasterises its string into a texture (see src/core/TextRasterizer.js) and samples it at
 * the incoming UV, so downstream it behaves exactly like a Texture 2D node: Color for the rendered
 * pixels, Mask for the glyph coverage to composite with.
 *
 * Placement of the *result* is left to the Transform nodes — wire a Rotate 2D / Scale 2D into the
 * UV input, or feed this node into a transform's Texture pin. The parameters here are the ones that
 * belong to the text itself.
 *
 * Every parameter is baked into the bitmap rather than delivered as a uniform, so an edit
 * re-rasterises instead of writing a uniform (see refreshTextNodeTexture).
 */
export const TextNodes = {
  Text: {
    label: "Text",
    cat: "Generators",
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "Color", type: "vec4" },
      { label: "Mask", type: "f32" },
    ],
    params: [
      {
        name: "text",
        type: "text",
        default: "TEXT",
        label: "Text",
        description: "The string to draw. Shift+Enter adds a line break.",
        group: "Content",
      },
      {
        name: "fontFamily",
        type: "select",
        options: ["sans-serif", "serif", "monospace", "cursive", "fantasy"],
        default: "sans-serif",
        label: "Font",
        group: "Content",
      },
      { name: "bold", type: "bool", default: false, label: "Bold", group: "Content" },
      { name: "italic", type: "bool", default: false, label: "Italic", group: "Content" },

      {
        name: "size",
        type: "float",
        default: 0.25,
        min: 0.01,
        max: 2.0,
        label: "Size",
        description: "Font size as a fraction of the texture, so the look survives a resolution change",
        group: "Layout",
      },
      {
        name: "lineHeight",
        type: "float",
        default: 1.2,
        min: 0.1,
        max: 4.0,
        label: "Line Height",
        description: "Spacing between lines, as a multiple of the font size",
        group: "Layout",
      },
      {
        name: "letterSpacing",
        type: "float",
        default: 0.0,
        min: -0.5,
        max: 2.0,
        label: "Letter Spacing",
        description: "Extra space between characters, in em",
        group: "Layout",
      },
      {
        name: "align",
        type: "select",
        options: ["left", "center", "right"],
        default: "center",
        label: "Align",
        group: "Layout",
      },
      {
        name: "posX",
        type: "float",
        default: 0.5,
        min: 0.0,
        max: 1.0,
        label: "Position X",
        group: "Layout",
      },
      {
        name: "posY",
        type: "float",
        default: 0.5,
        min: 0.0,
        max: 1.0,
        label: "Position Y",
        group: "Layout",
      },

      {
        name: "color",
        type: "color",
        default: [1.0, 1.0, 1.0, 1.0],
        label: "Fill",
        group: "Style",
      },
      {
        name: "outlineWidth",
        type: "float",
        default: 0.0,
        min: 0.0,
        max: 1.0,
        label: "Outline Width",
        description: "Outline thickness as a fraction of the font size (0 = no outline)",
        group: "Style",
      },
      {
        name: "outlineColor",
        type: "color",
        default: [0.0, 0.0, 0.0, 1.0],
        label: "Outline Color",
        group: "Style",
      },
      {
        name: "background",
        type: "color",
        default: [0.0, 0.0, 0.0, 0.0],
        label: "Background",
        description: "Fills the whole texture behind the text; alpha 0 leaves it transparent",
        group: "Style",
      },

      {
        name: "resolution",
        type: "int",
        default: 1024,
        min: 64,
        max: 4096,
        label: "Resolution",
        description: "Size of the rasterised texture, per side",
        group: "Texture",
        groupCollapsed: true,
      },
      {
        name: "wrap",
        type: "select",
        options: ["clamp", "repeat", "mirror"],
        default: "clamp",
        label: "Wrap",
        description: "How UVs outside the texture are sampled; clamp shows nothing outside it",
        group: "Texture",
      },
      {
        name: "filter",
        type: "select",
        options: ["linear", "nearest"],
        default: "linear",
        label: "Filter",
        group: "Texture",
      },
    ],
  },
};
