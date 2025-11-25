// src/utils/RedrawDiagnostics.js
// Lightweight, opt-in logging for redraw trigger analysis.
// Usage:
//   window.enableRedrawDiagnostics(true);
//   window.getRedrawDiagnostics();

const DEFAULT_MAX_EVENTS = 400;
const state = {
  enabled: false,
  buffer: [],
  maxEvents: DEFAULT_MAX_EVENTS,
};

const getTimestamp = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const pushEvent = (event) => {
  if (!state.enabled) {
    return;
  }
  state.buffer.push({
    ts: getTimestamp(),
    ...event,
  });
  if (state.buffer.length > state.maxEvents) {
    state.buffer.splice(0, state.buffer.length - state.maxEvents);
  }
};

export const enableRedrawDiagnostics = (enabled = true, options = {}) => {
  state.enabled = Boolean(enabled);
  if (typeof options.maxEvents === "number" && options.maxEvents > 0) {
    state.maxEvents = options.maxEvents;
  }
  if (!state.enabled) {
    state.buffer = [];
  }
  return state.enabled;
};

export const logRedrawTriggerEvent = (meta = {}) => {
  pushEvent({
    type: "trigger",
    source: meta.source || "unknown",
    reason: meta.reason || "unspecified",
    detail: meta.detail || null,
  });
};

export const logRedrawDirtyMark = (meta = {}) => {
  pushEvent({
    type: "dirty",
    reason: meta.reason || "unspecified",
    region: meta.region || "general",
    dirtyRegions: meta.dirtyRegions || null,
  });
};

export const logRedrawCommit = (meta = {}) => {
  pushEvent({
    type: "commit",
    dirtyRegions: meta.dirtyRegions || [],
    dirtyReasons: meta.dirtyReasons || [],
    isInteracting: Boolean(meta.isInteracting),
  });
};

export const getRedrawDiagnostics = () => [...state.buffer];

const attachDebugAPI = () => {
  if (typeof window === "undefined") {
    return;
  }
  if (!window.enableRedrawDiagnostics) {
    window.enableRedrawDiagnostics = enableRedrawDiagnostics;
  }
  if (!window.getRedrawDiagnostics) {
    window.getRedrawDiagnostics = getRedrawDiagnostics;
  }
};

attachDebugAPI();

