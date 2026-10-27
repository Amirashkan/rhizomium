// src/accessibility/flashAnalysis.js
//
// Measuring flashes and fast change in a run of rendered frames.
//
// The test is WCAG 2.x success criterion 2.3.1 ("Three Flashes or Below Threshold"), the same
// rule broadcast photosensitivity guidelines are built on:
//
//   - A FLASH is a pair of opposing changes in relative luminance, each of at least 10% of the
//     maximum, where the darker of the two states is below 0.80.
//   - A RED FLASH is a pair of opposing transitions involving a saturated red: R/(R+G+B) ≥ 0.8 and
//     a change of at least 20 in (R − G − B) × 320, computed in linear RGB.
//   - More than three flashes (or three red flashes) in any one second fails — once the flashing
//     area is large enough to matter: 25% of a 10° visual field, which on a typical screen at a
//     typical distance is about 2.5% of the screen.
//
// Frames are reduced to a coarse grid of cells first (mean linear RGB per cell). That is both
// cheap and the right thing to measure: what affects people is luminance change over an AREA, and
// a cell mean ignores fine noise that only shimmers. The counting is deliberately on the cautious
// side — a cell's transitions are counted whether or not its neighbours flash in step, and half a
// flash rounds up — because a warning someone did not need costs a click, and a missing one can
// cost a seizure.
//
// Beyond flashing, the "rapid change" share reports how much of the image changes strongly from
// one frame to the next. It catches the fast-motion cases (whip pans, strobing geometry, hard cuts
// every frame) that are not a luminance flash but that people with vestibular conditions are
// warned about too.

export const FLASH_LIMIT_PER_SECOND = 3;
export const LUMINANCE_DELTA = 0.1;
export const DARKER_STATE_LIMIT = 0.8;
export const RED_SATURATION = 0.8;
export const RED_DELTA = 20;
/** 25% of a 10° field, as a share of a full-screen frame. */
export const FLASH_AREA_SHARE = 0.025;
/** A frame-to-frame luminance change this large, over this share of the image, reads as rapid. */
export const RAPID_CHANGE_DELTA = 0.1;
export const RAPID_CHANGE_SHARE = 0.25;

const SRGB_TO_LINEAR = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return lut;
})();

/** Relative luminance (WCAG) of linear RGB. */
export function relativeLuminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Reduce one RGBA8 frame to a cols×rows grid of mean linear RGB.
 *
 * @param {Uint8Array|Uint8ClampedArray} pixels
 * @param {number} width
 * @param {number} height
 * @param {object} [options]
 * @param {number} [options.cols=16]
 * @param {number} [options.rows=9]
 * @param {number} [options.bytesPerRow=width*4]  padded row stride, as GPU readbacks deliver
 * @param {number} [options.offset=0]             where this frame starts in `pixels`
 * @param {boolean} [options.bgra=false]          channel order of a bgra8unorm canvas format
 * @returns {Float32Array} cols*rows*3 values: r, g, b per cell
 */
export function frameToCells(pixels, width, height, options = {}) {
  const { cols = 16, rows = 9, bytesPerRow = width * 4, offset = 0, bgra = false } = options;
  const cells = new Float32Array(cols * rows * 3);
  const counts = new Uint32Array(cols * rows);
  const rIndex = bgra ? 2 : 0;
  const bIndex = bgra ? 0 : 2;

  for (let y = 0; y < height; y++) {
    const cellRow = Math.min(rows - 1, Math.floor((y * rows) / height));
    const rowStart = offset + y * bytesPerRow;
    for (let x = 0; x < width; x++) {
      const cell = cellRow * cols + Math.min(cols - 1, Math.floor((x * cols) / width));
      const p = rowStart + x * 4;
      cells[cell * 3] += SRGB_TO_LINEAR[pixels[p + rIndex]];
      cells[cell * 3 + 1] += SRGB_TO_LINEAR[pixels[p + 1]];
      cells[cell * 3 + 2] += SRGB_TO_LINEAR[pixels[p + bIndex]];
      counts[cell] += 1;
    }
  }
  for (let c = 0; c < counts.length; c++) {
    const n = counts[c] || 1;
    cells[c * 3] /= n;
    cells[c * 3 + 1] /= n;
    cells[c * 3 + 2] /= n;
  }
  return cells;
}

/**
 * Frame indices at which a series makes a transition of at least `delta`, alternating in
 * direction (a transition only counts if it opposes the previous one). `darkerLimit`, when given,
 * requires the darker end of each transition to be below it.
 */
export function findTransitions(series, delta, darkerLimit = Infinity) {
  const transitions = [];
  if (!series.length) return transitions;
  let hi = series[0];
  let lo = series[0];
  let direction = 0; // 0 = none yet, 1 = last went up, -1 = last went down
  for (let t = 1; t < series.length; t++) {
    const v = series[t];
    if (v > hi) hi = v;
    if (v < lo) lo = v;
    if (direction !== -1 && hi - v >= delta && v < darkerLimit) {
      transitions.push(t);
      direction = -1;
      hi = lo = v;
    } else if (direction !== 1 && v - lo >= delta && lo < darkerLimit) {
      transitions.push(t);
      direction = 1;
      hi = lo = v;
    }
  }
  return transitions;
}

/** The most transitions inside any window of `windowFrames` consecutive frames. */
export function maxInWindow(transitions, windowFrames) {
  let best = 0;
  let start = 0;
  for (let end = 0; end < transitions.length; end++) {
    while (transitions[end] - transitions[start] >= windowFrames) start++;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

/**
 * Analyse a run of frames already reduced to cells.
 *
 * @param {Float32Array[]} frames  one frameToCells() result per frame, evenly spaced in time
 * @param {object} options
 * @param {number} options.fps     the spacing of the frames
 * @param {number} [options.areaShare=FLASH_AREA_SHARE]
 * @returns {{
 *   frames: number, seconds: number,
 *   flashesPerSecond: number, redFlashesPerSecond: number,
 *   flashArea: number, redFlashArea: number,
 *   generalFlashFail: boolean, redFlashFail: boolean,
 *   rapidChangeShare: number, rapidMotion: boolean,
 * }}
 */
export function analyzeCellFrames(frames, { fps, areaShare = FLASH_AREA_SHARE } = {}) {
  const frameCount = frames.length;
  const cellCount = frameCount ? frames[0].length / 3 : 0;
  const result = {
    frames: frameCount,
    seconds: fps > 0 ? frameCount / fps : 0,
    flashesPerSecond: 0,
    redFlashesPerSecond: 0,
    flashArea: 0,
    redFlashArea: 0,
    generalFlashFail: false,
    redFlashFail: false,
    rapidChangeShare: 0,
    rapidMotion: false,
  };
  if (frameCount < 2 || !cellCount || !(fps > 0)) return result;

  const windowFrames = Math.max(1, Math.round(fps));
  // "More than three flashes" = more than six transitions; a seventh is half a fourth flash,
  // and half a flash counts.
  const failingTransitions = FLASH_LIMIT_PER_SECOND * 2 + 1;
  const minCells = Math.max(1, Math.ceil(areaShare * cellCount));

  const generalPeaks = new Array(cellCount);
  const redPeaks = new Array(cellCount);
  const luminance = new Float32Array(frameCount);
  const red = new Float32Array(frameCount);
  let rapidSteps = 0;

  for (let c = 0; c < cellCount; c++) {
    for (let t = 0; t < frameCount; t++) {
      const r = frames[t][c * 3];
      const g = frames[t][c * 3 + 1];
      const b = frames[t][c * 3 + 2];
      luminance[t] = relativeLuminance(r, g, b);
      const sum = r + g + b;
      const saturated = sum > 0 && r / sum >= RED_SATURATION;
      red[t] = saturated ? Math.max(0, r - g - b) * 320 : 0;
    }
    generalPeaks[c] = maxInWindow(findTransitions(luminance, LUMINANCE_DELTA, DARKER_STATE_LIMIT), windowFrames);
    redPeaks[c] = maxInWindow(findTransitions(red, RED_DELTA), windowFrames);
  }

  for (let t = 1; t < frameCount; t++) {
    let changed = 0;
    for (let c = 0; c < cellCount; c++) {
      const now = relativeLuminance(frames[t][c * 3], frames[t][c * 3 + 1], frames[t][c * 3 + 2]);
      const before = relativeLuminance(
        frames[t - 1][c * 3],
        frames[t - 1][c * 3 + 1],
        frames[t - 1][c * 3 + 2],
      );
      if (Math.abs(now - before) >= RAPID_CHANGE_DELTA) changed += 1;
    }
    if (changed / cellCount >= RAPID_CHANGE_SHARE) rapidSteps += 1;
  }

  // The flash rate that covers enough of the image: the minCells-th busiest cell.
  const rateAtArea = (peaks) => [...peaks].sort((a, b) => b - a)[minCells - 1] / 2;
  const shareAbove = (peaks) => peaks.filter((p) => p >= failingTransitions).length / cellCount;

  result.flashesPerSecond = rateAtArea(generalPeaks);
  result.redFlashesPerSecond = rateAtArea(redPeaks);
  result.flashArea = shareAbove(generalPeaks);
  result.redFlashArea = shareAbove(redPeaks);
  result.generalFlashFail = result.flashArea >= areaShare;
  result.redFlashFail = result.redFlashArea >= areaShare;
  result.rapidChangeShare = rapidSteps / (frameCount - 1);
  // Rapid change in more than a third of the frame steps — sustained, not a single cut.
  result.rapidMotion = result.rapidChangeShare > 1 / 3;
  return result;
}
