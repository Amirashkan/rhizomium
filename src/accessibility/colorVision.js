// src/accessibility/colorVision.js
//
// Colour-vision profiles for the visual preview.
//
// Two jobs share one mechanism:
//
//   simulate — show the render the way a viewer with a colour-vision deficiency sees it, so an
//              artist can check that a piece still reads for the one in twelve men (and one in two
//              hundred women) who have one.
//   correct  — "daltonise" the render for an artist who has one themselves: the contrast their
//              eyes cannot pick up is moved into channels they can, so colours that collapse into
//              each other come apart again.
//
// Both are a single 3×3 matrix applied to linear RGB, which is exactly what an SVG
// <feColorMatrix> does with its default color-interpolation-filters="linearRGB". So a profile is
// one <filter> element in the document, applied with CSS `filter: url(#…)` to the preview canvas
// and the 3D viewport, and with the 2D context's `filter` to the node thumbnails. Nothing touches
// the WebGPU pipeline: exports, published media and the output screens always carry the real
// colours — what an audience sees is never filtered.
//
// Simulation matrices are Machado, Oliveira & Fernandes (2009), "A Physiologically-based Model
// for Simulation of Color Vision Deficiency": severity 1.0 for the dichromacies and 0.6 for the
// anomalous trichromacies, the usual stand-in for a moderate case. Achromatopsia reduces colour to
// relative luminance (Rec. 709 weights, the ones WCAG's luminance formula uses).
//
// Correction is the classic error-redistribution daltonisation (Fidaner, Lin & Ozguven): the part
// of the image a deficient eye loses, (I − S)·rgb, is pushed into the channels it keeps through a
// shift matrix E, giving out = (I + E·(I − S))·rgb. Every row of S sums to 1, so greys — and black
// and white — come through untouched; only chromatic contrast moves.

import { getA11ySettings } from "./a11ySettings.js";

/** The id of the shared filter element, and what CSS and the canvases reference. */
export const CVD_FILTER_ID = "rz-cvd-filter";

const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Simulation matrices in linear RGB, row-major (out = M · in). */
export const CVD_SIMULATION_MATRICES = Object.freeze({
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
  protanomaly: [
    [0.38545, 0.769005, -0.154455],
    [0.100526, 0.829802, 0.069673],
    [-0.007442, -0.02219, 1.029632],
  ],
  deuteranomaly: [
    [0.547494, 0.607765, -0.155259],
    [0.181692, 0.781742, 0.036566],
    [-0.01041, 0.027275, 0.983136],
  ],
  tritanomaly: [
    [1.104996, -0.046633, -0.058363],
    [-0.032137, 0.971635, 0.060503],
    [0.001336, 0.317922, 0.680742],
  ],
  achromatopsia: [
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
  ],
});

/**
 * Where the lost contrast goes when correcting. Red–green losses (protan, deutan) move into green
 * and blue; blue–yellow losses (tritan) move into red and green.
 */
const RED_GREEN_SHIFT = [
  [0, 0, 0],
  [0.7, 1, 0],
  [0.7, 0, 1],
];
const BLUE_YELLOW_SHIFT = [
  [1, 0, 0.7],
  [0, 1, 0.7],
  [0, 0, 0],
];

const SHIFT_FOR_PROFILE = {
  protanopia: RED_GREEN_SHIFT,
  protanomaly: RED_GREEN_SHIFT,
  deuteranopia: RED_GREEN_SHIFT,
  deuteranomaly: RED_GREEN_SHIFT,
  tritanopia: BLUE_YELLOW_SHIFT,
  tritanomaly: BLUE_YELLOW_SHIFT,
};

/** Human names for the settings menu. */
export const COLOR_VISION_LABELS = Object.freeze({
  none: "Off",
  protanopia: "Protanopia (no red cones)",
  deuteranopia: "Deuteranopia (no green cones)",
  tritanopia: "Tritanopia (no blue cones)",
  achromatopsia: "Achromatopsia (no colour)",
  protanomaly: "Protanomaly (weak red)",
  deuteranomaly: "Deuteranomaly (weak green)",
  tritanomaly: "Tritanomaly (weak blue)",
});

function multiply(a, b) {
  return a.map((row) =>
    [0, 1, 2].map((col) => row[0] * b[0][col] + row[1] * b[1][col] + row[2] * b[2][col]),
  );
}

function subtract(a, b) {
  return a.map((row, r) => row.map((value, c) => value - b[r][c]));
}

function add(a, b) {
  return a.map((row, r) => row.map((value, c) => value + b[r][c]));
}

/**
 * The 3×3 linear-RGB matrix for a profile and mode, or null when nothing should be applied.
 *
 * Achromatopsia has no correction: with no colour channel left there is nowhere to move the lost
 * contrast, so "correct" falls back to showing it unfiltered rather than pretending.
 */
export function colorVisionMatrix(profile, mode = "simulate") {
  const simulation = CVD_SIMULATION_MATRICES[profile];
  if (!simulation) return null;
  if (mode !== "correct") return simulation.map((row) => [...row]);

  const shift = SHIFT_FOR_PROFILE[profile];
  if (!shift) return null;
  return add(IDENTITY, multiply(shift, subtract(IDENTITY, simulation)));
}

/** Apply a 3×3 matrix to an [r, g, b] triple in linear RGB. */
export function applyColorMatrix(matrix, rgb) {
  return matrix.map((row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
}

/** The 20 numbers an <feColorMatrix type="matrix"> wants: the 3×3 padded to RGBA. */
export function feColorMatrixValues(matrix) {
  const round = (n) => Number(n.toFixed(6));
  return [
    ...matrix[0].map(round), 0, 0,
    ...matrix[1].map(round), 0, 0,
    ...matrix[2].map(round), 0, 0,
    0, 0, 0, 1, 0,
  ].join(" ");
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Put (or update) the shared <filter> in `doc`. Returns the filter element. */
export function ensureColorVisionFilter(doc, matrix) {
  if (!doc?.body) return null;
  let filter = doc.getElementById(CVD_FILTER_ID);
  if (!filter) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    filter = doc.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", CVD_FILTER_ID);
    // linearRGB is the default, but it is the whole reason the matrices above are correct, so it
    // is written down rather than left implicit.
    filter.setAttribute("color-interpolation-filters", "linearRGB");
    const op = doc.createElementNS(SVG_NS, "feColorMatrix");
    op.setAttribute("type", "matrix");
    filter.appendChild(op);
    svg.appendChild(filter);
    doc.body.appendChild(svg);
  }
  const op = filter.querySelector("feColorMatrix") || filter.firstElementChild;
  op?.setAttribute("values", feColorMatrixValues(matrix || IDENTITY));
  return filter;
}

/**
 * The value to assign to a 2D context's `filter` while drawing a preview thumbnail, or "none".
 * Read per draw by the canvas renderer, so it has to be cheap: one cached string.
 */
let canvasFilterValue = "none";
export function colorVisionCanvasFilter() {
  return canvasFilterValue;
}

/** Documents (the editor, a popped-out preview window) whose preview follows the profile. */
const attachedDocuments = new Set();

function applyToDocument(doc, profile, mode) {
  const root = doc?.documentElement;
  if (!root) return;
  const matrix = colorVisionMatrix(profile, mode);
  if (matrix) {
    ensureColorVisionFilter(doc, matrix);
    root.dataset.rzCvd = `${profile}-${mode}`;
  } else {
    delete root.dataset.rzCvd;
  }
}

function currentProfile(settings) {
  return {
    profile: settings.get("colorVision"),
    mode: settings.get("colorVisionMode"),
  };
}

/**
 * Bring `doc` under the colour-vision setting: the filter element, and the data-rz-cvd attribute
 * the stylesheet hangs the preview's `filter:` rule from.
 *
 * A popped-out preview window is a second document: its canvas is the same element, moved, so it
 * needs the filter defined over there too (see previewPopout.js). `extraCss` lets that window
 * carry the canvas rule without loading the editor's stylesheet.
 */
export function attachColorVisionDocument(doc, { settings = getA11ySettings(), extraCss = null } = {}) {
  if (!doc) return () => {};
  attachedDocuments.add(doc);
  if (extraCss && doc.head && !doc.getElementById("rz-cvd-style")) {
    const style = doc.createElement("style");
    style.id = "rz-cvd-style";
    style.textContent = extraCss;
    doc.head.appendChild(style);
  }
  const { profile, mode } = currentProfile(settings);
  applyToDocument(doc, profile, mode);
  return () => attachedDocuments.delete(doc);
}

/** The rule a popped-out preview window needs, since it does not load accessibility.css. */
export const POPOUT_CVD_CSS = `:root[data-rz-cvd] canvas { filter: url(#${CVD_FILTER_ID}); }`;

/**
 * Follow the colour-vision setting from now on: the editor document, any attached popout, and the
 * canvas-filter string the renderer reads for thumbnails. `onChange` runs after each change so the
 * caller can repaint the node canvas.
 *
 * @returns {() => void} stops following
 */
export function installColorVision({ settings = getA11ySettings(), doc = document, onChange = null } = {}) {
  const sync = () => {
    const { profile, mode } = currentProfile(settings);
    canvasFilterValue = colorVisionMatrix(profile, mode) ? `url(#${CVD_FILTER_ID})` : "none";
    for (const attached of [...attachedDocuments]) {
      // A closed popout's document is still an object; drop it rather than write into it.
      if (attached !== doc && attached.defaultView?.closed !== false) {
        attachedDocuments.delete(attached);
        continue;
      }
      applyToDocument(attached, profile, mode);
    }
    onChange?.({ profile, mode });
  };

  attachColorVisionDocument(doc, { settings });
  sync();
  const unsubscribe = settings.subscribe(({ key }) => {
    if (key === "colorVision" || key === "colorVisionMode" || key === "*") sync();
  });
  return unsubscribe;
}
