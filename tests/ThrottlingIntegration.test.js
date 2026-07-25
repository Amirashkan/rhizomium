// tests/ThrottlingIntegration.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PreviewThrottler } from '../src/preview/PreviewThrottler.js';
import { getInteractionStateManager } from '../src/utils/InteractionStateManager.js';

describe('Throttling Integration', () => {
  let throttler;
  let interactionStateManager;

  beforeEach(() => {
    throttler = new PreviewThrottler();
    interactionStateManager = getInteractionStateManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    throttler.dispose();
    interactionStateManager.reset();
  });

  describe('Interaction State Integration', () => {
    it('should throttle updates during dragging', () => {
      const updateFn = vi.fn();
      
      interactionStateManager.setDragging(true);
      throttler.beginDrag();
      
      // Rapid updates
      for (let i = 0; i < 10; i++) {
        throttler.requestUpdate(updateFn);
      }
      
      // Should be throttled to drag interval (50ms)
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      vi.advanceTimersByTime(60);
      expect(updateFn).toHaveBeenCalledTimes(2);
    });

    it('should throttle updates during editing', () => {
      const updateFn = vi.fn();
      
      interactionStateManager.setEditing(true);
      throttler.beginEdit();
      
      // Rapid updates
      for (let i = 0; i < 10; i++) {
        throttler.requestUpdate(updateFn);
      }
      
      // Should be throttled to edit interval (100ms)
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      vi.advanceTimersByTime(110);
      expect(updateFn).toHaveBeenCalledTimes(2);
    });

    it('should return to idle throttling after interaction ends', () => {
      const updateFn = vi.fn();
      
      // Start in drag mode
      throttler.beginDrag();
      throttler.requestUpdate(updateFn); // Executes immediately
      throttler.requestUpdate(updateFn); // Scheduled
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      // Advance time so scheduled update fires
      vi.advanceTimersByTime(50);
      expect(updateFn).toHaveBeenCalledTimes(2);
      
      // End drag - switches to idle mode (16ms interval)
      throttler.endDrag();
      interactionStateManager.setDragging(false);
      
      // Should use idle interval (16ms) now
      throttler.requestUpdate(updateFn); // May execute immediately or schedule
      // If it scheduled, advance time
      if (updateFn.mock.calls.length === 2) {
        vi.advanceTimersByTime(20);
      }
      expect(updateFn).toHaveBeenCalledTimes(3);
      
      throttler.requestUpdate(updateFn);
      vi.advanceTimersByTime(20);
      expect(updateFn).toHaveBeenCalledTimes(4);
    });
  });

  describe('Mode Priority', () => {
    it('should prioritize compile mode during compilation', () => {
      const updateFn = vi.fn();
      
      throttler.beginDrag();
      throttler.beginCompile();
      
      // Should use compile interval (500ms)
      throttler.requestUpdate(updateFn);
      throttler.requestUpdate(updateFn);
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      vi.advanceTimersByTime(100);
      expect(updateFn).toHaveBeenCalledTimes(1); // Still throttled
      
      vi.advanceTimersByTime(500);
      expect(updateFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle rapid mode switches', () => {
      const updateFn = vi.fn();
      
      // Simulate user interaction flow
      throttler.beginDrag();
      throttler.requestUpdate(updateFn); // Executes immediately (1 call)
      
      // Don't advance time - call immediately to test scheduling
      throttler.endDrag();
      throttler.beginEdit();
      throttler.requestUpdate(updateFn); // Should schedule (edit mode: 100ms, but no time passed)
      
      throttler.endEdit();
      throttler.beginCompile();
      throttler.requestUpdate(updateFn); // Should reschedule (compile mode: 500ms)
      
      // Should have executed first update only (others are scheduled)
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      // Advance time - the pending update should fire after compile interval
      vi.advanceTimersByTime(500);
      
      // Should have 2 calls total (first + scheduled)
      expect(updateFn).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed interaction states', () => {
      const updateFn = vi.fn();
      
      // Simulate multiple simultaneous interactions
      interactionStateManager.setDragging(true);
      interactionStateManager.setPanning(true);
      
      throttler.beginDrag();
      throttler.beginEdit();
      
      // Should use most restrictive mode (edit: 100ms)
      throttler.requestUpdate(updateFn);
      throttler.requestUpdate(updateFn);
      
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      vi.advanceTimersByTime(110);
      expect(updateFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance Characteristics', () => {
    it('should maintain frame rate targets during interactions', () => {
      const updateFn = vi.fn();
      
      throttler.beginDrag(); // 50ms interval = 20fps
      
      // Simulate 1 second of updates
      for (let i = 0; i < 100; i++) {
        throttler.requestUpdate(updateFn);
        vi.advanceTimersByTime(10); // 10ms per frame attempt
      }
      
      // Should have approximately 20 updates (20fps)
      // First call executes immediately, then ~20 more in 1000ms = ~21 total
      const expectedUpdates = Math.floor(1000 / 50) + 1; // ~21 (first immediate + 20 scheduled)
      expect(updateFn).toHaveBeenCalledTimes(expectedUpdates);
    });

    it('should reduce update frequency during compilation', () => {
      const updateFn = vi.fn();
      
      throttler.beginCompile(); // 500ms interval = 2fps
      
      // Simulate 1 second of updates
      for (let i = 0; i < 100; i++) {
        throttler.requestUpdate(updateFn);
        vi.advanceTimersByTime(10);
      }
      
      // Should have approximately 2 updates (2fps)
      // First call executes immediately, then ~2 more in 1000ms = ~3 total
      const expectedUpdates = Math.floor(1000 / 500) + 1; // ~3 (first immediate + 2 scheduled)
      expect(updateFn).toHaveBeenCalledTimes(expectedUpdates);
    });
  });
});

