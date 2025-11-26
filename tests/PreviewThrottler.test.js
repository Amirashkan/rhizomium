// tests/PreviewThrottler.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PreviewThrottler } from '../src/preview/PreviewThrottler.js';

describe('PreviewThrottler', () => {
  let throttler;

  beforeEach(() => {
    throttler = new PreviewThrottler();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    throttler.dispose();
  });

  describe('Basic Throttling', () => {
    it('should execute update immediately when enough time has passed', () => {
      const updateFn = vi.fn();
      
      throttler.requestUpdate(updateFn);
      
      expect(updateFn).toHaveBeenCalledTimes(1);
    });

    it('should throttle updates when called too frequently', () => {
      const updateFn = vi.fn();
      
      // First call - immediate
      throttler.requestUpdate(updateFn);
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      // Second call immediately after - should be throttled
      throttler.requestUpdate(updateFn);
      expect(updateFn).toHaveBeenCalledTimes(1); // Still 1
      
      // Advance time past idle interval (16ms)
      vi.advanceTimersByTime(20);
      expect(updateFn).toHaveBeenCalledTimes(2);
    });

    it('should cancel pending updates when immediate is requested', () => {
      const updateFn1 = vi.fn();
      const updateFn2 = vi.fn();
      
      // Request update (will be throttled)
      throttler.requestUpdate(updateFn1);
      expect(updateFn1).toHaveBeenCalledTimes(1);
      
      // Request another update immediately
      throttler.requestUpdate(updateFn1);
      expect(updateFn1).toHaveBeenCalledTimes(1);
      
      // Request immediate update
      throttler.requestUpdate(updateFn2, true);
      expect(updateFn2).toHaveBeenCalledTimes(1);
      
      // Advance time - first update should not fire
      vi.advanceTimersByTime(20);
      expect(updateFn1).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe('Mode Management', () => {
    it('should use correct interval for idle mode', () => {
      throttler.setMode('idle');
      expect(throttler.mode).toBe('idle');
      expect(throttler.intervals.idle).toBe(16);
    });

    it('should use correct interval for edit mode', () => {
      throttler.setMode('edit');
      expect(throttler.mode).toBe('edit');
      expect(throttler.intervals.edit).toBe(100);
    });

    it('should use correct interval for drag mode', () => {
      throttler.setMode('drag');
      expect(throttler.mode).toBe('drag');
      expect(throttler.intervals.drag).toBe(50);
    });

    it('should use correct interval for compile mode', () => {
      throttler.setMode('compile');
      expect(throttler.mode).toBe('compile');
      expect(throttler.intervals.compile).toBe(500);
    });

    it('should throttle more aggressively in compile mode', () => {
      const updateFn = vi.fn();
      throttler.setMode('compile');
      
      throttler.requestUpdate(updateFn);
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      // Immediate second call
      throttler.requestUpdate(updateFn);
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      // Advance less than compile interval
      vi.advanceTimersByTime(100);
      expect(updateFn).toHaveBeenCalledTimes(1); // Still throttled
      
      // Advance past compile interval
      vi.advanceTimersByTime(500);
      expect(updateFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Interaction State Management', () => {
    it('should enter drag mode when beginDrag is called', () => {
      throttler.beginDrag();
      expect(throttler.isDragging).toBe(true);
      expect(throttler.mode).toBe('drag');
    });

    it('should exit drag mode when endDrag is called', () => {
      throttler.beginDrag();
      expect(throttler.mode).toBe('drag');
      
      throttler.endDrag();
      expect(throttler.isDragging).toBe(false);
      expect(throttler.mode).toBe('idle');
    });

    it('should enter edit mode when beginEdit is called', () => {
      throttler.beginEdit();
      expect(throttler.isEditing).toBe(true);
      expect(throttler.mode).toBe('edit');
    });

    it('should exit edit mode when endEdit is called', () => {
      throttler.beginEdit();
      expect(throttler.mode).toBe('edit');
      
      throttler.endEdit();
      expect(throttler.isEditing).toBe(false);
      expect(throttler.mode).toBe('idle');
    });

    it('should enter compile mode when beginCompile is called', () => {
      throttler.beginCompile();
      expect(throttler.isCompiling).toBe(true);
      expect(throttler.mode).toBe('compile');
    });

    it('should exit compile mode when endCompile is called', () => {
      throttler.beginCompile();
      expect(throttler.mode).toBe('compile');
      
      throttler.endCompile();
      expect(throttler.isCompiling).toBe(false);
      expect(throttler.mode).toBe('idle');
    });

    it('should prioritize compile mode over other modes', () => {
      throttler.beginDrag();
      throttler.beginEdit();
      throttler.beginCompile();
      
      expect(throttler.mode).toBe('compile');
      
      throttler.endCompile();
      expect(throttler.mode).toBe('drag'); // Should fall back to drag
    });

    it('should prioritize drag mode over edit mode', () => {
      throttler.beginEdit();
      throttler.beginDrag();
      
      expect(throttler.mode).toBe('drag');
      
      throttler.endDrag();
      expect(throttler.mode).toBe('edit');
    });
  });

  describe('Update Mode Logic', () => {
    it('should update mode correctly based on interaction state', () => {
      throttler.beginCompile();
      throttler.updateMode();
      expect(throttler.mode).toBe('compile');
      
      throttler.endCompile();
      throttler.beginDrag();
      throttler.updateMode();
      expect(throttler.mode).toBe('drag');
      
      throttler.endDrag();
      throttler.beginEdit();
      throttler.updateMode();
      expect(throttler.mode).toBe('edit');
      
      throttler.endEdit();
      throttler.updateMode();
      expect(throttler.mode).toBe('idle');
    });
  });

  describe('Disposal', () => {
    it('should cancel pending updates on dispose', () => {
      const updateFn = vi.fn();
      
      throttler.requestUpdate(updateFn);
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      throttler.requestUpdate(updateFn);
      expect(updateFn).toHaveBeenCalledTimes(1);
      
      throttler.dispose();
      
      // Advance time - update should not fire
      vi.advanceTimersByTime(100);
      expect(updateFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Throttling Behavior', () => {
    it('should respect different intervals for different modes', () => {
      const updateFn = vi.fn();
      
      // Test idle mode (16ms)
      throttler.setMode('idle');
      throttler.requestUpdate(updateFn);
      throttler.requestUpdate(updateFn);
      vi.advanceTimersByTime(20);
      expect(updateFn).toHaveBeenCalledTimes(2);
      
      updateFn.mockClear();
      
      // Test drag mode (50ms)
      throttler.setMode('drag');
      throttler.requestUpdate(updateFn);
      throttler.requestUpdate(updateFn);
      vi.advanceTimersByTime(30);
      expect(updateFn).toHaveBeenCalledTimes(1); // Still throttled
      vi.advanceTimersByTime(30);
      expect(updateFn).toHaveBeenCalledTimes(2);
    });

    it('should handle rapid mode switches correctly', () => {
      const updateFn = vi.fn();
      
      throttler.setMode('idle');
      throttler.requestUpdate(updateFn);
      
      throttler.setMode('drag');
      throttler.requestUpdate(updateFn);
      
      throttler.setMode('compile');
      throttler.requestUpdate(updateFn);
      
      // Should use compile interval (500ms) for pending update
      vi.advanceTimersByTime(100);
      expect(updateFn).toHaveBeenCalledTimes(1); // Still only first call
      
      vi.advanceTimersByTime(500);
      expect(updateFn).toHaveBeenCalledTimes(2); // Second call fires
    });
  });
});

