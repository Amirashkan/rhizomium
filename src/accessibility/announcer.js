// src/accessibility/announcer.js
//
// Spoken feedback for screen readers: two visually hidden live regions and one function to talk
// through them.
//
// Moving keyboard focus already makes a screen reader read the item it lands on, so this is for
// the other half — things that happen without focus going anywhere: a wire connected, a node
// deleted, a move finished, playback held for a motion check. Each of those would otherwise be
// silent to someone who cannot see the canvas change.
//
// Repeating the same sentence twice in a row ("Connected", "Connected") would normally be
// swallowed, because a live region only speaks when its text CHANGES. The region is cleared first
// and refilled on the next tick, which reads as a change every time.
//
// How much gets said follows Preferences → Accessibility → Screen reader announcements:
//   off     — nothing (the screen reader still reads whatever has focus)
//   normal  — results of actions
//   verbose — also the running commentary (positions while moving, counts after each edit)

import { getA11ySettings } from "./a11ySettings.js";

const REGION_IDS = {
  polite: "rz-a11y-live-polite",
  assertive: "rz-a11y-live-assertive",
};

/**
 * The CSS that keeps an element in the accessibility tree while taking it out of the visual one.
 * Not `display:none` or `visibility:hidden`, both of which also hide it from screen readers.
 */
export const VISUALLY_HIDDEN_CSS =
  "position:absolute!important;width:1px!important;height:1px!important;padding:0!important;" +
  "margin:-1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;" +
  "clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important;";

function ensureRegion(doc, politeness) {
  const id = REGION_IDS[politeness];
  let region = doc.getElementById(id);
  if (region) return region;

  region = doc.createElement("div");
  region.id = id;
  region.setAttribute("aria-live", politeness);
  region.setAttribute("aria-atomic", "true");
  // role=status / role=alert carry the same politeness for screen readers that key off the role.
  region.setAttribute("role", politeness === "assertive" ? "alert" : "status");
  region.className = "rz-visually-hidden";
  region.style.cssText = VISUALLY_HIDDEN_CSS;
  doc.body.appendChild(region);
  return region;
}

const pending = new Map();

/**
 * Say `message` through a live region.
 *
 * @param {string} message
 * @param {object} [options]
 * @param {"polite"|"assertive"} [options.priority="polite"]  assertive interrupts; keep it for
 *        things that must not wait (a playback hold, an error)
 * @param {boolean} [options.verbose=false]  only spoken when announcements are set to verbose
 * @param {Document} [options.doc]
 * @param {object} [options.settings]  settings store to read the announcement level from
 * @returns {boolean} whether anything was queued
 */
export function announce(message, options = {}) {
  const {
    priority = "polite",
    verbose = false,
    doc = typeof document !== "undefined" ? document : null,
    settings = getA11ySettings(),
  } = options;

  const text = typeof message === "string" ? message.trim() : "";
  if (!text || !doc?.body) return false;

  const level = settings?.get?.("announcements") ?? "normal";
  if (level === "off") return false;
  if (verbose && level !== "verbose") return false;

  const politeness = priority === "assertive" ? "assertive" : "polite";
  const region = ensureRegion(doc, politeness);

  // Clear, then refill on the next tick: identical consecutive messages still read as a change.
  region.textContent = "";
  clearTimeout(pending.get(region));
  pending.set(
    region,
    setTimeout(() => {
      region.textContent = text;
      pending.delete(region);
    }, 30),
  );
  return true;
}

/** Create both live regions up front, so the first announcement is not lost while one is built. */
export function installAnnouncer(doc = document) {
  if (!doc?.body) return;
  ensureRegion(doc, "polite");
  ensureRegion(doc, "assertive");
}
