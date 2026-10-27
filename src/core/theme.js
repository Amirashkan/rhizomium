// src/core/theme.js
//
// The editor's visual language, in JS.
//
// Everything the DOM chrome uses lives in src/styles/tokens.css as CSS custom
// properties. The canvas renderer can't read those cheaply (a getComputedStyle
// per node per frame is exactly the kind of layout read the renderer works hard
// to avoid), and several panels build their markup in JS, so the same palette
// is mirrored here as plain values. The two files are a matched pair — change a
// colour in one and change it in the other, or the drawn graph and the chrome
// around it stop looking like the same application.
//
// Two colour systems, deliberately independent:
//
//   CATEGORY_COLORS — a node's IDENTITY. Muted, calm. Used for the node's left
//                     spine, its header dot, the add-node menu's rings and the
//                     parameter panel's swatch. It never touches a wire.
//
//   TYPE_COLORS     — the live SIGNAL. Bright. Used for ports, wires, value
//                     tags and type badges. It never touches a node's chrome.
//
// Mixing them is what made the old palette read as noise: every surface was
// coloured, so no colour meant anything.
//
// The surface, text and node-chrome objects are LIVE. Preferences →
// Accessibility → Contrast rewrites them in place (applyContrastPalette below),
// so the renderer and every panel that builds its markup from these values pick
// up the change on their next paint without importing anything new. The
// matching CSS overrides live in src/styles/accessibility.css.

/** Warm charcoal surfaces, hairlines and text ramp. */
export const SURFACE = {
  app: "#100d0b",
  deep: "#0a0807",
  panelTop: "#171310",
  panelBottom: "#141110",
  surface: "#141110", // flat window body (no gradient)
  raised: "#1a1611",
  well: "#0f0c0a",
  nodeTop: "#221c17",
  nodeBottom: "#191410",
  line: "rgba(255, 244, 230, 0.08)",
  lineStrong: "rgba(255, 244, 230, 0.13)",
  hover: "rgba(255, 244, 230, 0.07)",
  fillSoft: "rgba(255, 244, 230, 0.05)",
};

export const TEXT = {
  primary: "#f3ede4",
  secondary: "#cabfb0",
  tertiary: "#8f867a",
  faint: "#6f6559",
  disabled: "#5b5349",
};

/** The single accent. Selection, primary actions, live indicators, playhead. */
export const ACCENT = {
  base: "#c6f24e",
  hover: "#d7f877",
  deep: "#a9d63c",
  ink: "#14110a",
};

export const SEMANTIC = {
  error: "#f8615a",
  warn: "#f5a524",
  success: "#46a883",
  successDot: "#34d399",
  info: "#22d3ee",
  audio: "#a78bfa",
};

/**
 * Node identity. Keys are the `cat` field on a NodeDefs entry, and the twelve
 * below are exactly the twelve this graph actually uses (src/data/NodeDefs.js).
 *
 * The design handoff names its families slightly differently from the ones in
 * the codebase, so the palette is mapped onto the real categories by meaning:
 *
 *   handoff "Pattern" → Generators  (shapes, gradients, noise sources)
 *   handoff "Color"   → Modifiers   (invert, mix, grayscale, blur…)
 *   handoff "Compute" → Dynamics    (particles, fluid, reaction-diffusion)
 *   handoff "Noise"   → Effects     (feedback, warp, kaleidoscope, glitch)
 *
 * The extra keys after them are aliases for names used in older menus and in
 * the handoff itself, so a stray category string still lands on a real colour
 * instead of falling through to grey.
 */
export const CATEGORY_COLORS = {
  Input: "#46a883",
  Output: "#cf5f57",
  Math: "#c99a4a",
  Vector: "#5f80bf",
  Generators: "#cf6499",
  Transform: "#a074c9",
  Modifiers: "#46a89b",
  Utility: "#4aa6ba",
  Blend: "#6f9cc4",
  Texture: "#c2a94f",
  Dynamics: "#c46f7d",
  Effects: "#8f7ec9",

  // Aliases.
  Pattern: "#cf6499",
  Color: "#46a89b",
  Compute: "#c46f7d",
  // "Simulation" was this family's name until it was renamed; graphs and
  // presets saved under the old name still resolve to the same colour.
  Simulation: "#c46f7d",
  Noise: "#8f7ec9",
  Field: "#8f7ec9",
  // Text nodes render glyphs into a texture and keep their own warm tone
  // rather than borrowing another family's.
  Text: "#b98a5e",
};

export const CATEGORY_DEFAULT = "#7f766a";

/**
 * Review annotations. A third, deliberately small system: what a COMMENT means,
 * not what a node is or what a wire carries.
 *
 * These borrow the semantic ramp rather than inventing a palette, because that
 * is what they mean — a blocker is an error, a requested change is a warning,
 * praise is a success, a question is information. Reusing SEMANTIC keeps the
 * review layer legible against a canvas already using category and type colour
 * for everything else, and means a pin never reads as a node's identity.
 *
 * `ink` is what to draw ON the filled pin. The mid-tone fills take the deep
 * surface; nothing here is light enough to need a light ink.
 *
 * Mirrored in tokens.css as --rz-tag-* for the DOM side of the review panel.
 */
export const ANNOTATION_TAGS = {
  question: { label: "Question", color: SEMANTIC.info },
  change: { label: "Change", color: SEMANTIC.warn },
  blocker: { label: "Blocker", color: SEMANTIC.error },
  praise: { label: "Praise", color: SEMANTIC.success },
  note: { label: "Note", color: TEXT.tertiary },
};

/** Fill for a resolved pin, whatever tag it carries — resolved outranks tag. */
export const ANNOTATION_RESOLVED_COLOR = SEMANTIC.success;

/** Text/glyph colour on a filled annotation pin. */
export const ANNOTATION_PIN_INK = SURFACE.deep;

/**
 * The live signal. Keys are pin types as they appear in NodeDefs `pinsOut` /
 * `pinsIn` (`f32`, `vec2`, …), plus the wider names TypeSystem.js uses, so a
 * pin declared either way resolves to the same colour.
 */
export const TYPE_COLORS = {
  // float — amber
  f32: "#f5a524",
  float: "#f5a524",
  int: "#f5a524",
  // vectors — violet
  vec2: "#c084fc",
  vec3: "#c084fc",
  vec: "#c084fc",
  uv: "#c084fc",
  // colour / rgba — teal
  vec4: "#2dd4bf",
  color: "#2dd4bf",
  rgba: "#2dd4bf",
  // textures & fields — cyan
  texture: "#22d3ee",
  texture2d: "#22d3ee",
  texture3d: "#22d3ee",
  tex: "#22d3ee",
  field: "#22d3ee",
};

export const TYPE_DEFAULT = "#9aa0a6";

/** Category colour for a NodeDefs `cat` value. */
export function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || CATEGORY_DEFAULT;
}

/** Data-type colour for a pin type. `dynamic` and unknown types read neutral. */
export function typeColor(type) {
  return TYPE_COLORS[type] || TYPE_DEFAULT;
}

/**
 * `hex` at `alpha`. Accepts #rgb and #rrggbb; anything else is returned
 * untouched so an already-rgba() token can be passed straight through.
 */
export function withAlpha(hex, alpha) {
  if (typeof hex !== "string" || hex[0] !== "#") return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Type faces, matching --rz-font-ui / --rz-font-mono in tokens.css. */
export const FONT_UI =
  '"Space Grotesk", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
export const FONT_MONO =
  '"JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace';

/**
 * Node anatomy, as drawn. The measurements that decide where things *are*
 * (header height, row pitch, port inset) live in src/core/pinLayout.js and are
 * shared with hit-testing; these are the purely cosmetic ones the renderer
 * needs and nothing else may depend on.
 */
export const NODE_STYLE = {
  radius: 12, // card corner
  spineWidth: 3, // category-colour left spine
  spineInset: 1, // keeps the spine inside the card's border
  headerDot: 3, // radius of the category dot in the header
  portRadius: 5.5, // output port
  portRadiusIn: 4.5, // input port
  portRing: "#1a1611", // the ring punched out of every port
  previewRadius: 8,
};

/**
 * The node card's hairlines and weights — the part of the drawn graph a higher
 * contrast setting has to be able to reach. Faint by design at the standard
 * level; the grid dots are an RGB triple so the renderer can vary their alpha.
 */
export const NODE_CHROME = {
  headerFill: "rgba(255, 244, 230, 0.035)", // the header's lift off the body
  headerLine: "rgba(255, 244, 230, 0.07)", // hairline under the header
  border: "rgba(255, 244, 230, 0.09)", // card outline
  borderWidth: 1,
  thumbBorder: "rgba(255, 244, 230, 0.1)", // hairline round the preview band
  gridDot: "255, 240, 220",
  gridAlphaMinor: 0.06,
  gridAlphaMajor: 0.11,
  wireWidth: 2.5,
  // The keyboard focus ring (see src/accessibility/GraphNavigator.js): a light
  // ring over a dark halo, so it reads on the card, on the canvas and on a
  // bright thumbnail alike — and never borrows the lime that means "selected".
  focusRing: "#ffffff",
  focusHalo: "rgba(0, 0, 0, 0.85)",
  focusWidth: 2.5,
};

/**
 * What each contrast level changes. "standard" is the palette above as
 * written; the others are overlays on it. Lime selection and the type and
 * category hues stay put at every level — they already clear contrast against
 * the dark ground — so what moves is the chrome: text, hairlines, borders,
 * surfaces and the weight of wires and rings.
 */
const CONTRAST_OVERLAYS = {
  standard: {},
  high: {
    surface: {
      nodeTop: "#1c1712",
      nodeBottom: "#120f0c",
      line: "rgba(255, 244, 230, 0.3)",
      lineStrong: "rgba(255, 244, 230, 0.5)",
      hover: "rgba(255, 244, 230, 0.16)",
      fillSoft: "rgba(255, 244, 230, 0.08)",
    },
    text: {
      primary: "#ffffff",
      secondary: "#f1e9de",
      tertiary: "#d6ccbf",
      faint: "#b9ae9f",
      disabled: "#8f857a",
    },
    chrome: {
      headerFill: "rgba(255, 244, 230, 0.08)",
      headerLine: "rgba(255, 244, 230, 0.35)",
      border: "rgba(255, 244, 230, 0.55)",
      borderWidth: 1.5,
      thumbBorder: "rgba(255, 244, 230, 0.45)",
      gridAlphaMinor: 0.12,
      gridAlphaMajor: 0.22,
      wireWidth: 3.5,
      focusWidth: 3,
    },
    node: {},
  },
  maximum: {
    surface: {
      app: "#000000",
      deep: "#000000",
      panelTop: "#000000",
      panelBottom: "#000000",
      surface: "#000000",
      raised: "#000000",
      well: "#000000",
      nodeTop: "#000000",
      nodeBottom: "#000000",
      line: "#ffffff",
      lineStrong: "#ffffff",
      hover: "rgba(255, 255, 255, 0.22)",
      fillSoft: "rgba(255, 255, 255, 0.1)",
    },
    text: {
      primary: "#ffffff",
      secondary: "#ffffff",
      tertiary: "#ffffff",
      faint: "#e6e6e6",
      disabled: "#a6a6a6",
    },
    chrome: {
      headerFill: "rgba(255, 255, 255, 0.12)",
      headerLine: "#ffffff",
      border: "#ffffff",
      borderWidth: 2,
      thumbBorder: "#ffffff",
      gridDot: "255, 255, 255",
      gridAlphaMinor: 0.2,
      gridAlphaMajor: 0.35,
      wireWidth: 4,
      focusWidth: 3.5,
    },
    node: { portRing: "#000000" },
  },
};

const PALETTE_BASELINE = {
  surface: { ...SURFACE },
  text: { ...TEXT },
  chrome: { ...NODE_CHROME },
  node: { ...NODE_STYLE },
};

let activeContrast = "standard";
let paletteGeneration = 0;

/**
 * Switch the live palette to a contrast level ("standard" | "high" |
 * "maximum"). Unknown levels fall back to standard. Returns true when anything
 * changed, so the caller knows to repaint.
 */
export function applyContrastPalette(level) {
  const next = CONTRAST_OVERLAYS[level] ? level : "standard";
  if (next === activeContrast) return false;
  const overlay = CONTRAST_OVERLAYS[next];
  Object.assign(SURFACE, PALETTE_BASELINE.surface, overlay.surface || {});
  Object.assign(TEXT, PALETTE_BASELINE.text, overlay.text || {});
  Object.assign(NODE_CHROME, PALETTE_BASELINE.chrome, overlay.chrome || {});
  Object.assign(NODE_STYLE, PALETTE_BASELINE.node, overlay.node || {});
  activeContrast = next;
  paletteGeneration += 1;
  return true;
}

/** The contrast level the live palette is at. */
export function activeContrastLevel() {
  return activeContrast;
}

/**
 * Bumped on every palette switch. Caches keyed by colour (the renderer's grid
 * tile and node gradients) include it so they rebuild instead of serving the
 * previous palette.
 */
export function paletteVersion() {
  return paletteGeneration;
}
