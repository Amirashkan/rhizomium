/**
 * Tests for PerfProbe - the always-on frame attribution probe (Phase 0).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PerfProbe, getPerfProbe } from '../src/utils/PerfProbe.js';

describe('PerfProbe', () => {
  let probe;
  let now;

  beforeEach(() => {
    probe = new PerfProbe();
    now = 1000;
    vi.spyOn(probe, '_now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('tick (rAF cadence)', () => {
    it('records gaps between ticks', () => {
      probe.tick();
      now += 16;
      probe.tick();
      now += 16;
      probe.tick();

      const report = probe.report(10000);
      expect(report.frames.frames).toBe(2);
      expect(report.frames.p50GapMs).toBeCloseTo(16, 1);
    });

    it('counts stalls above thresholds', () => {
      probe.tick();
      now += 16;
      probe.tick();
      now += 30; // >25ms stall
      probe.tick();
      now += 150; // >100ms stall
      probe.tick();

      const report = probe.report(10000);
      expect(report.frames['stalls>25ms']).toBe(2); // 30ms and 150ms
      expect(report.frames['stalls>100ms']).toBe(1); // 150ms
      expect(report.frames.maxGapMs).toBe(150);
    });
  });

  describe('sections', () => {
    it('times begin/end sections', () => {
      const token = probe.begin('canvasDraw');
      now += 12;
      const duration = probe.end(token);

      expect(duration).toBe(12);
      const report = probe.report(10000);
      expect(report.sections.canvasDraw.count).toBe(1);
      expect(report.sections.canvasDraw.maxMs).toBe(12);
      expect(report.sections.canvasDraw.totalMs).toBe(12);
    });

    it('computes percentiles over many samples', () => {
      for (let i = 1; i <= 100; i++) {
        const token = probe.begin('work');
        now += i; // durations 1..100
        probe.end(token);
      }

      const report = probe.report(100000);
      expect(report.sections.work.count).toBe(100);
      expect(report.sections.work.p50Ms).toBeGreaterThanOrEqual(45);
      expect(report.sections.work.p50Ms).toBeLessThanOrEqual(55);
      expect(report.sections.work.p95Ms).toBeGreaterThanOrEqual(90);
      expect(report.sections.work.maxMs).toBe(100);
    });

    it('ignores null tokens from end()', () => {
      expect(probe.end(null)).toBe(0);
      expect(probe.end(undefined)).toBe(0);
    });
  });

  describe('counters', () => {
    it('aggregates counts and rates', () => {
      probe.count('warmupBurst');
      now += 1000;
      probe.count('computeDispatches', 6);
      probe.count('computeDispatches', 6);

      const report = probe.report(10000);
      expect(report.counters.warmupBurst.total).toBe(1);
      expect(report.counters.computeDispatches.total).toBe(12);
      expect(report.counters.computeDispatches.events).toBe(2);
      expect(report.counters.computeDispatches.perSecond).toBeCloseTo(1.2, 1);
    });
  });

  describe('report window', () => {
    it('excludes samples older than the window', () => {
      const token = probe.begin('old');
      now += 5;
      probe.end(token);
      probe.count('oldCounter');

      now += 60000; // jump past the window

      const token2 = probe.begin('fresh');
      now += 5;
      probe.end(token2);

      const report = probe.report(10000);
      expect(report.sections.old).toBeUndefined();
      expect(report.counters.oldCounter).toBeUndefined();
      expect(report.sections.fresh.count).toBe(1);
    });
  });

  describe('reset', () => {
    it('clears all series', () => {
      probe.tick();
      now += 16;
      probe.tick();
      probe.count('x');
      const token = probe.begin('y');
      probe.end(token);

      probe.reset();
      const report = probe.report(10000);
      expect(report.frames.frames).toBe(0);
      expect(Object.keys(report.sections)).toHaveLength(0);
      expect(Object.keys(report.counters)).toHaveLength(0);
    });
  });

  describe('singleton', () => {
    it('returns the same instance and installs window hooks', () => {
      const a = getPerfProbe();
      const b = getPerfProbe();
      expect(a).toBe(b);
      expect(window.perfProbe).toBe(a);
      expect(typeof window.perfReport).toBe('function');
    });
  });

  describe('ring buffer', () => {
    it('does not grow unbounded', () => {
      for (let i = 0; i < 10000; i++) {
        const token = probe.begin('hot');
        now += 1;
        probe.end(token);
      }
      // Series is capped; report still works and reflects recent samples
      const report = probe.report(1000);
      expect(report.sections.hot.count).toBeLessThanOrEqual(4000);
      expect(report.sections.hot.count).toBeGreaterThan(0);
    });
  });
});
