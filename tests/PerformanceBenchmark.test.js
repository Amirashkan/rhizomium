// tests/PerformanceBenchmark.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformanceBenchmark, getPerformanceBenchmark } from '../src/utils/PerformanceBenchmark.js';

describe('PerformanceBenchmark', () => {
  let benchmark;

  beforeEach(() => {
    benchmark = new PerformanceBenchmark();
    vi.useFakeTimers();
  });

  afterEach(() => {
    benchmark.clearResults();
    vi.useRealTimers();
  });

  describe('Throttled Scenarios', () => {
    it('should provide throttled scenario factories', () => {
      const scenarios = PerformanceBenchmark.getThrottledScenarios();
      
      expect(scenarios).toHaveProperty('parameterDragging');
      expect(scenarios).toHaveProperty('canvasPanning');
      expect(scenarios).toHaveProperty('shaderCompilation');
      expect(scenarios).toHaveProperty('rapidGraphChanges');
      expect(scenarios).toHaveProperty('cacheThrashing');
      expect(scenarios).toHaveProperty('mixedInteractions');
    });

    it('should create parameter dragging scenario', () => {
      const scenarios = PerformanceBenchmark.getThrottledScenarios();
      const scenario = scenarios.parameterDragging();
      
      expect(scenario.name).toBe('Parameter Dragging (Throttled)');
      expect(scenario.setup).toBeInstanceOf(Function);
      expect(scenario.onFrame).toBeInstanceOf(Function);
      expect(scenario.cleanup).toBeInstanceOf(Function);
    });

    it('should create canvas panning scenario', () => {
      const scenarios = PerformanceBenchmark.getThrottledScenarios();
      const scenario = scenarios.canvasPanning();
      
      expect(scenario.name).toBe('Canvas Panning (Throttled)');
      expect(scenario.setup).toBeInstanceOf(Function);
    });

    it('should create shader compilation scenario', () => {
      const scenarios = PerformanceBenchmark.getThrottledScenarios();
      const scenario = scenarios.shaderCompilation();
      
      expect(scenario.name).toBe('Shader Compilation (Throttled)');
      expect(scenario.setup).toBeInstanceOf(Function);
    });

    it('should create rapid graph changes scenario', () => {
      const scenarios = PerformanceBenchmark.getThrottledScenarios();
      const scenario = scenarios.rapidGraphChanges();
      
      expect(scenario.name).toBe('Rapid Graph Changes');
      expect(scenario.setup).toBeInstanceOf(Function);
    });

    it('should create cache thrashing scenario', () => {
      const scenarios = PerformanceBenchmark.getThrottledScenarios();
      const scenario = scenarios.cacheThrashing();
      
      expect(scenario.name).toBe('Cache Thrashing');
      expect(scenario.setup).toBeInstanceOf(Function);
    });

    it('should create mixed interactions scenario', () => {
      const scenarios = PerformanceBenchmark.getThrottledScenarios();
      const scenario = scenarios.mixedInteractions();
      
      expect(scenario.name).toBe('Mixed Interactions (Complex Throttling)');
      expect(scenario.setup).toBeInstanceOf(Function);
    });
  });

  describe('Scenario Execution', () => {
    it('should execute scenario setup and cleanup', async () => {
      const setupFn = vi.fn(async () => ({ test: true }));
      const cleanupFn = vi.fn(async () => {});
      const onFrameFn = vi.fn();
      
      const scenario = {
        name: 'Test Scenario',
        setup: setupFn,
        cleanup: cleanupFn,
        onFrame: onFrameFn
      };

      // Mock requestAnimationFrame
      global.requestAnimationFrame = vi.fn((cb) => {
        setTimeout(cb, 0);
        return 1;
      });

      const promise = benchmark.runTest(scenario, {
        warmupFrames: 0,
        measurementFrames: 1,
        cooldownFrames: 0
      });

      // Advance timers to complete test
      await vi.runAllTimersAsync();
      
      try {
        await promise;
      } catch (e) {
        // May fail due to missing dependencies, but setup/cleanup should be called
      }

      expect(setupFn).toHaveBeenCalled();
      expect(cleanupFn).toHaveBeenCalled();
    });
  });

  describe('Results Comparison', () => {
    it('should compare benchmark results', () => {
      const before = {
        averageFPS: 60,
        averageFrameTime: 16.67,
        frameTimeDistribution: { p95: 20 },
        systemAverages: {
          canvas: 5,
          gpu: 8,
          other: 2
        },
        budgetExceededCount: 0
      };

      const after = {
        averageFPS: 70,
        averageFrameTime: 14.29,
        frameTimeDistribution: { p95: 18 },
        systemAverages: {
          canvas: 4,
          gpu: 7,
          other: 1
        },
        budgetExceededCount: 0
      };

      const comparison = benchmark.compareResults(before, after);
      
      expect(comparison).toBeDefined();
      expect(comparison.fps.improvement).toBe(10);
      expect(comparison.frameTime.improvement).toBeGreaterThan(0);
      expect(comparison.systemTimes.canvas.improvement).toBe(1);
    });
  });

  describe('Singleton', () => {
    it('should return same instance from getPerformanceBenchmark', () => {
      const instance1 = getPerformanceBenchmark();
      const instance2 = getPerformanceBenchmark();
      
      expect(instance1).toBe(instance2);
    });
  });
});

