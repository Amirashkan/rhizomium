// src/utils/PerfProbe.js
//
// Lightweight, always-on frame attribution probe.
//
// Unlike PreviewPerfMonitor (opt-in overlay, samples lightly during
// interactions), this probe keeps cheap ring buffers of raw samples so a
// report can attribute where frame time actually went over the last N
// seconds — including during interactions, which is exactly when the
// editor feels slow.
//
// Usage from the browser console:
//   window.perfReport()        // summary of the last 10 seconds
//   window.perfReport(30000)   // summary of the last 30 seconds
//
// Instrumented sections/counters are documented in report() output.

const MAX_SAMPLES = 4000; // per series; ~66s of 60fps frames

class Series {
  constructor() {
    this.times = new Float64Array(MAX_SAMPLES); // sample timestamp (ms)
    this.values = new Float64Array(MAX_SAMPLES); // duration or count
    this.next = 0;
    this.length = 0;
  }

  push(timestamp, value) {
    this.times[this.next] = timestamp;
    this.values[this.next] = value;
    this.next = (this.next + 1) % MAX_SAMPLES;
    if (this.length < MAX_SAMPLES) this.length++;
  }

  /** Collect values newer than `since`, in insertion order. */
  collect(since) {
    const out = [];
    const start = (this.next - this.length + MAX_SAMPLES) % MAX_SAMPLES;
    for (let i = 0; i < this.length; i++) {
      const idx = (start + i) % MAX_SAMPLES;
      if (this.times[idx] >= since) out.push(this.values[idx]);
    }
    return out;
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(values) {
  if (values.length === 0) {
    return { count: 0, p50: 0, p95: 0, max: 0, totalMs: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  let total = 0;
  for (const v of values) total += v;
  return {
    count: values.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    totalMs: total,
  };
}

const round1 = (v) => Math.round(v * 10) / 10;

export class PerfProbe {
  constructor() {
    this.sections = new Map(); // name -> Series of durations
    this.counters = new Map(); // name -> Series of counts
    this._lastTick = 0;
    this._rafGaps = new Series();
  }

  _now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /**
   * Record one animation-loop frame boundary. Call once per rAF-driven
   * frame (not for manual/out-of-band renders) so the gap series reflects
   * the real animation cadence the user perceives.
   */
  tick() {
    const now = this._now();
    if (this._lastTick > 0) {
      this._rafGaps.push(now, now - this._lastTick);
    }
    this._lastTick = now;
  }

  /** Start timing a section. Returns a token for end(). */
  begin(name) {
    return { name, start: this._now() };
  }

  /** Finish timing a section started with begin(). Returns duration in ms. */
  end(token) {
    if (!token) return 0;
    const now = this._now();
    const duration = now - token.start;
    let series = this.sections.get(token.name);
    if (!series) {
      series = new Series();
      this.sections.set(token.name, series);
    }
    series.push(now, duration);
    return duration;
  }

  /** Record a counted event (e.g. 'warmupBurst', 'computeDispatch'). */
  count(name, n = 1) {
    let series = this.counters.get(name);
    if (!series) {
      series = new Series();
      this.counters.set(name, series);
    }
    series.push(this._now(), n);
  }

  /**
   * Build an attribution report over the last `windowMs` milliseconds.
   * Logs tables to the console and returns the raw data.
   */
  report(windowMs = 10000) {
    const now = this._now();
    const since = now - windowMs;
    const seconds = windowMs / 1000;

    // Frame cadence from rAF gaps
    const gaps = this._rafGaps.collect(since);
    const gapStats = summarize(gaps);
    const stalls25 = gaps.filter((g) => g > 25).length;
    const stalls100 = gaps.filter((g) => g > 100).length;
    const frames = {
      frames: gaps.length,
      avgFps: gaps.length > 0 ? round1(1000 / (gapStats.totalMs / gaps.length)) : 0,
      p50GapMs: round1(gapStats.p50),
      p95GapMs: round1(gapStats.p95),
      maxGapMs: round1(gapStats.max),
      "stalls>25ms": stalls25,
      "stalls>100ms": stalls100,
    };

    const sections = {};
    for (const [name, series] of this.sections) {
      const stats = summarize(series.collect(since));
      if (stats.count === 0) continue;
      sections[name] = {
        count: stats.count,
        p50Ms: round1(stats.p50),
        p95Ms: round1(stats.p95),
        maxMs: round1(stats.max),
        totalMs: round1(stats.totalMs),
        "% of window": round1((stats.totalMs / windowMs) * 100),
      };
    }

    const counters = {};
    for (const [name, series] of this.counters) {
      const values = series.collect(since);
      if (values.length === 0) continue;
      let total = 0;
      for (const v of values) total += v;
      counters[name] = {
        events: values.length,
        total,
        perSecond: round1(total / seconds),
      };
    }

    const result = { windowMs, frames, sections, counters };

    if (typeof console !== "undefined" && console.table) {
      console.log(`[PerfProbe] Report over last ${round1(seconds)}s`);
      console.log("[PerfProbe] Frame cadence (rAF gaps):");
      console.table([frames]);
      if (Object.keys(sections).length > 0) {
        console.log("[PerfProbe] Main-thread sections:");
        console.table(sections);
      }
      if (Object.keys(counters).length > 0) {
        console.log("[PerfProbe] Counters:");
        console.table(counters);
      }
    }

    return result;
  }

  reset() {
    this.sections.clear();
    this.counters.clear();
    this._rafGaps = new Series();
    this._lastTick = 0;
  }
}

let _instance = null;

export function getPerfProbe() {
  if (!_instance) {
    _instance = new PerfProbe();
    if (typeof window !== "undefined") {
      window.perfProbe = _instance;
      window.perfReport = (windowMs) => _instance.report(windowMs);
    }
  }
  return _instance;
}
