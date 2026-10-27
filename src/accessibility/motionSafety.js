// src/accessibility/motionSafety.js
//
// Warnings before fast motion plays.
//
// With Preferences → Accessibility → "Warn before playing fast motion or flashing" on, a patch
// that is opened — from a file, a backup, a starter, the AI panel — does not start moving until it
// has been checked. Playback is held on the first frame, the next two seconds of the shader are
// rendered offscreen and measured against the WCAG flash thresholds (flashAnalysis.js), the patch
// is read for motion the measurement cannot see (patchMotionScan.js), and then either it plays, or
// a warning says what was found and offers to play it anyway, play it slowed down, or keep it
// paused.
//
// Two things it deliberately does not do:
//   - interrupt a live set. A VJ scene switch or a coPerformer cue loads a project too, but a
//     dialog in front of a performer mid-show is its own hazard, and those scenes were chosen in
//     advance; they are let through.
//   - hide anything. A held patch is visible, paused; nothing is blanked or skipped, and the
//     choice of what happens next is the viewer's.
//
// Tools → Check Flashing & Motion runs the same check on demand, for an artist who wants to know
// before publishing whether a piece is safe to show.

import { scanPatchForMotion } from "./patchMotionScan.js";
import { analyzeCellFrames, frameToCells, FLASH_LIMIT_PER_SECOND } from "./flashAnalysis.js";
import { getA11ySettings } from "./a11ySettings.js";
import { announce } from "./announcer.js";
import { modalManager } from "../ui/ModalManager.js";

export const SAMPLE_SECONDS = 2;
export const SAMPLE_FPS = 60;
const SAMPLE_WIDTH = 64;
const GRID_COLS = 16;
const GRID_ROWS = 9;

/**
 * Project-load sources that belong to a live performance (see the header). "vj-scene" is the tag
 * src/vj/TransitionManager.js puts on every scene cut, coPerformer cues included.
 */
export const LIVE_LOAD_SOURCES = new Set(["vj-scene"]);

/**
 * Render the next `seconds` of the shader offscreen and measure them. Returns null when there is
 * nothing to render yet (no compiled shader) or the renderer cannot capture.
 */
export async function measurePreviewMotion(
  renderer,
  { startTime = 0, timeScale = 1, seconds = SAMPLE_SECONDS, fps = SAMPLE_FPS, aspect = 16 / 9 } = {},
) {
  if (!renderer?.pipeline || typeof renderer.captureFrameSequence !== "function") return null;
  const width = SAMPLE_WIDTH;
  const height = Math.max(8, Math.round(width / (Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9)));
  const count = Math.max(2, Math.round(seconds * fps));
  // Sample at the rate it will PLAY: a patch shown at 2× time scale flashes twice as fast.
  const step = (Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1) / fps;
  const times = Array.from({ length: count }, (_, i) => startTime + i * step);

  const capture = await renderer.captureFrameSequence({ width, height, times });
  if (!capture?.count) return null;
  const bgra = /^bgra/i.test(capture.format || "");
  const frames = [];
  for (let i = 0; i < capture.count; i++) {
    frames.push(
      frameToCells(capture.pixels, capture.width, capture.height, {
        cols: GRID_COLS,
        rows: GRID_ROWS,
        bytesPerRow: capture.bytesPerRow,
        offset: i * capture.frameBytes,
        bgra,
      }),
    );
  }
  return analyzeCellFrames(frames, { fps });
}

function roundRate(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Turn a measurement and the scan's findings into one verdict.
 *
 * @returns {{risk: "high"|"medium"|"none", reasons: string[], notes: string[],
 *            measurement: object|null, findings: object[], fastestRate: number|null}}
 */
export function assessMotion({ measurement = null, findings = [], measureError = null } = {}) {
  const reasons = [];
  const notes = [];
  let risk = "none";
  let fastestRate = null;
  const raise = (level) => {
    if (level === "high" || (level === "medium" && risk === "none")) risk = level;
  };

  if (measurement) {
    if (measurement.generalFlashFail) {
      raise("high");
      fastestRate = measurement.flashesPerSecond;
      reasons.push(
        `The image flashes about ${roundRate(measurement.flashesPerSecond)} times a second over ${Math.round(
          measurement.flashArea * 100,
        )}% of the frame. The safe limit is ${FLASH_LIMIT_PER_SECOND}.`,
      );
    }
    if (measurement.redFlashFail) {
      raise("high");
      fastestRate = Math.max(fastestRate || 0, measurement.redFlashesPerSecond);
      reasons.push(
        `Saturated red flashes about ${roundRate(measurement.redFlashesPerSecond)} times a second — red flashes are the most likely to trigger seizures.`,
      );
    }
    if (measurement.rapidMotion && !measurement.generalFlashFail) {
      raise("medium");
      reasons.push("Large parts of the image change sharply from one frame to the next.");
    }
  } else if (measureError) {
    notes.push("The rendered frames could not be measured, so only the patch itself was checked.");
  }

  for (const finding of findings) {
    if (finding.severity === "medium") {
      raise("medium");
      reasons.push(finding.message);
      if (Number.isFinite(finding.rateHz)) fastestRate = Math.max(fastestRate || 0, finding.rateHz);
    } else {
      notes.push(finding.message);
    }
  }

  return { risk, reasons, notes, measurement, findings, fastestRate };
}

/**
 * A slower speed that brings the fastest flashing found under the limit: the largest of ½, ¼,
 * ⅒ and 1/20 that keeps it at or below 2.5 a second.
 */
export function suggestedSlowdown(fastestRate) {
  if (!Number.isFinite(fastestRate) || fastestRate <= 0) return 0.25;
  for (const factor of [0.5, 0.25, 0.1, 0.05]) {
    if (fastestRate * factor <= 2.5) return factor;
  }
  return 0.05;
}

/** Scan, measure and assess — the whole check, never throwing. */
export async function checkPatchMotion({ graph, renderer, timeScale = 1, startTime = 0, aspect, measure = true } = {}) {
  const findings = scanPatchForMotion(graph, { timeScale });
  let measurement = null;
  let measureError = null;
  if (measure) {
    try {
      measurement = await measurePreviewMotion(renderer, { startTime, timeScale, aspect });
    } catch (error) {
      measureError = error;
      console.warn("[motionSafety] Frame sampling failed:", error);
    }
  }
  return assessMotion({ measurement, findings, measureError });
}

function percentLabel(factor) {
  return `${Math.round(factor * 100)}%`;
}

/**
 * The warning. Resolves to "play", "slow" or "stay" — and to "stay" for Escape or a click on the
 * backdrop, because the safe answer has to be the one you get by doing nothing.
 *
 * With `manual: true` (Tools → Check Flashing & Motion) it is a report rather than a gate, and a
 * clean result is shown too.
 */
export function showMotionWarning(report, { manual = false, playing = false } = {}) {
  const slow = suggestedSlowdown(report.fastestRate);
  const body = document.createElement("div");
  body.className = "rz-motion-report";

  const lead = document.createElement("p");
  lead.className = "rz-motion-lead";
  if (report.risk === "none") {
    lead.textContent =
      "No flashing above the safe limit, and no fast motion, was found in the next two seconds of this patch.";
  } else if (manual) {
    lead.textContent =
      "This patch may contain fast motion or flashing that can affect people with photosensitive epilepsy, migraine or vestibular disorders.";
  } else {
    lead.textContent =
      "This patch may contain fast motion or flashing that can affect people with photosensitive epilepsy, migraine or vestibular disorders. It is paused on its first frame.";
  }
  body.appendChild(lead);

  if (report.reasons.length) {
    const list = document.createElement("ul");
    list.className = "rz-motion-reasons";
    for (const reason of report.reasons) {
      const li = document.createElement("li");
      li.textContent = reason;
      list.appendChild(li);
    }
    body.appendChild(list);
  }
  if (report.notes.length) {
    const notes = document.createElement("ul");
    notes.className = "rz-motion-notes";
    for (const note of report.notes) {
      const li = document.createElement("li");
      li.textContent = note;
      notes.appendChild(li);
    }
    body.appendChild(notes);
  }

  const caveat = document.createElement("p");
  caveat.className = "rz-motion-caveat";
  caveat.textContent =
    "Checked against the WCAG limit of three flashes a second, on the shader's own clock. Audio, video, live input and simulations can change what actually plays.";
  body.appendChild(caveat);

  let choice = manual ? null : "stay";
  const buttons = manual
    ? [
        ...(playing && report.risk !== "none"
          ? [{ label: "Pause Preview", onClick: () => { choice = "stay"; } }]
          : []),
        { label: "Close", primary: true, onClick: () => {} },
      ]
    : [
        { label: "Play Anyway", onClick: () => { choice = "play"; } },
        { label: `Play at ${percentLabel(slow)} Speed`, onClick: () => { choice = "slow"; } },
        { label: "Keep Paused", primary: true, onClick: () => { choice = "stay"; } },
      ];

  return modalManager
    .custom({
      title: report.risk === "none" ? "No Flashing Found" : "Motion Warning",
      role: report.risk === "none" ? "dialog" : "alertdialog",
      body,
      buttons,
    })
    .then(() => ({ choice, slowdown: slow }));
}

/**
 * Holds playback around project loads and runs the check (see the header).
 *
 * `timing` is the preview clock: { isPaused(), setPaused(bool), getTimeScale(), setTimeScale(n) }.
 * `check` runs checkPatchMotion with the live renderer and graph; `warn` shows the dialog.
 */
export class MotionGate {
  constructor({
    settings = getA11ySettings(),
    timing,
    check,
    warn = showMotionWarning,
    say = announce,
    waitForShader = () => Promise.resolve(),
  } = {}) {
    this.settings = settings;
    this.timing = timing;
    this.check = check;
    this.warn = warn;
    this.say = say;
    this.waitForShader = waitForShader;
    this._hold = null;
    this._slowedFrom = null;
    this._onLoading = (event) => this.onProjectLoading(event?.detail || {});
    this._onLoaded = (event) => this.onProjectLoaded(event?.detail || {});
  }

  install(target = window) {
    target.addEventListener("rz:project-loading", this._onLoading);
    target.addEventListener("rz:project-loaded", this._onLoaded);
    return () => {
      target.removeEventListener("rz:project-loading", this._onLoading);
      target.removeEventListener("rz:project-loaded", this._onLoaded);
    };
  }

  /** Whether a load is being held right now. */
  isHolding() {
    return !!this._hold;
  }

  onProjectLoading({ source = null } = {}) {
    if (!this.timing || this._hold) return;
    if (!this.settings.motionWarningsEnabled()) return;
    if (LIVE_LOAD_SOURCES.has(source)) return;

    // A slow-down chosen for the previous patch does not carry over to the next one.
    if (this._slowedFrom !== null) {
      this.timing.setTimeScale(this._slowedFrom);
      this._slowedFrom = null;
    }
    this._hold = { wasPaused: !!this.timing.isPaused() };
    this.timing.setPaused(true);
  }

  async onProjectLoaded({ failed = false } = {}) {
    const hold = this._hold;
    if (!hold) return null;

    if (failed) {
      this._hold = null;
      this.timing.setPaused(hold.wasPaused);
      return null;
    }

    let report;
    try {
      await this.waitForShader();
      report = await this.check();
    } catch (error) {
      console.warn("[motionSafety] Motion check failed:", error);
      report = assessMotion({ measureError: error });
    }

    if (report.risk === "none") {
      this._hold = null;
      this.timing.setPaused(hold.wasPaused);
      this.say("Motion check passed.", { verbose: true });
      return { report, choice: "play" };
    }

    this.say("Playback is paused: this patch may contain fast motion or flashing.", { priority: "assertive" });
    const { choice, slowdown } = await this.warn(report, { manual: false });
    this._hold = null;

    if (choice === "play") {
      this.timing.setPaused(false);
    } else if (choice === "slow") {
      this._slowedFrom = this.timing.getTimeScale();
      this.timing.setTimeScale(this._slowedFrom * slowdown);
      this.timing.setPaused(false);
      this.say(`Playing at ${percentLabel(slowdown)} speed.`);
    } else {
      this.say("Playback stays paused. View → Play Preview starts it when you are ready.");
    }
    return { report, choice };
  }

  /** Tools → Check Flashing & Motion. */
  async checkNow() {
    const report = await this.check();
    const playing = !!this.timing && !this.timing.isPaused();
    this.say(
      report.risk === "none" ? "No flashing or fast motion found." : "This patch may contain fast motion or flashing.",
    );
    const { choice } = await this.warn(report, { manual: true, playing });
    if (choice === "stay" && this.timing) this.timing.setPaused(true);
    return report;
  }
}
