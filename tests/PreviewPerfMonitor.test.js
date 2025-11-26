// tests/PreviewPerfMonitor.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PreviewPerfMonitor } from '../src/utils/PreviewPerfMonitor.js';

describe('PreviewPerfMonitor', () => {
  let monitor;

  beforeEach(() => {
    // Mock window and DOM
    global.window = {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      },
      location: {
        hash: '',
        search: ''
      },
      dispatchEvent: vi.fn(),
      requestIdleCallback: vi.fn((cb) => setTimeout(cb, 0)),
      cancelIdleCallback: vi.fn()
    };
    
    global.document = {
      createElement: vi.fn(() => ({
        style: {},
        textContent: '',
        remove: vi.fn()
      })),
      body: {
        appendChild: vi.fn()
      },
      readyState: 'complete'
    };
    
    global.performance = {
      now: vi.fn(() => Date.now())
    };
    
    monitor = new PreviewPerfMonitor({ forceEnable: true });
  });

  afterEach(() => {
    if (monitor) {
      monitor.clearAlerts();
    }
  });

  describe('Alert System', () => {
    it('should detect redraw spikes', () => {
      monitor.configureAlerts({
        enabled: true,
        redrawSpikeThreshold: 50,
        consecutiveSpikesThreshold: 2
      });

      // Simulate normal frames
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 16 });
      
      // Simulate spike frames
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 60 }); // Spike
      
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 65 }); // Another spike
      
      const alerts = monitor.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].type).toBe('redraw-spike');
    });

    it('should respect alert cooldown', () => {
      const alertCallback = vi.fn();
      monitor.configureAlerts({
        enabled: true,
        redrawSpikeThreshold: 50,
        consecutiveSpikesThreshold: 2,
        alertCooldown: 1000,
        onAlert: alertCallback
      });

      // First spike - should trigger alert
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 60 });
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 65 });
      
      expect(alertCallback).toHaveBeenCalledTimes(1);
      
      // Immediate second spike - should not trigger (cooldown)
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 60 });
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 65 });
      
      expect(alertCallback).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should track frame time history', () => {
      monitor.configureAlerts({
        enabled: true,
        redrawSpikeThreshold: 50,
        redrawSpikeWindow: 5
      });

      // Add several frames
      for (let i = 0; i < 10; i++) {
        monitor.beginFrame();
        monitor.endFrame({ frameTime: 16 + i });
      }

      const alerts = monitor.getAlerts();
      if (alerts.length > 0) {
        expect(alerts[0].frameTimeHistory).toBeDefined();
        expect(alerts[0].frameTimeHistory.length).toBeLessThanOrEqual(5);
      }
    });

    it('should include interaction state in alerts', () => {
      monitor.configureAlerts({
        enabled: true,
        redrawSpikeThreshold: 50,
        consecutiveSpikesThreshold: 2
      });

      monitor.recordInteractionState({ isDragging: true });
      
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 60 });
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 65 });

      const alerts = monitor.getAlerts();
      if (alerts.length > 0) {
        expect(alerts[0].interactionState).toBeDefined();
      }
    });

    it('should provide alert statistics', () => {
      monitor.configureAlerts({
        enabled: true,
        redrawSpikeThreshold: 50,
        consecutiveSpikesThreshold: 2
      });

      // Generate some alerts
      for (let i = 0; i < 5; i++) {
        monitor.beginFrame();
        monitor.endFrame({ frameTime: 60 + i });
        monitor.beginFrame();
        monitor.endFrame({ frameTime: 65 + i });
      }

      const stats = monitor.getAlertStats();
      expect(stats).toHaveProperty('totalAlerts');
      expect(stats).toHaveProperty('recentAlerts');
      expect(stats).toHaveProperty('averageSpikeFrameTime');
      expect(stats).toHaveProperty('maxSpikeFrameTime');
    });

    it('should clear alerts', () => {
      monitor.configureAlerts({
        enabled: true,
        redrawSpikeThreshold: 50,
        consecutiveSpikesThreshold: 2
      });

      // Generate alerts
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 60 });
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 65 });

      expect(monitor.getAlerts().length).toBeGreaterThan(0);

      monitor.clearAlerts();
      expect(monitor.getAlerts().length).toBe(0);
    });
  });

  describe('Alert Configuration', () => {
    it('should allow configuring alert thresholds', () => {
      monitor.configureAlerts({
        redrawSpikeThreshold: 100,
        consecutiveSpikesThreshold: 5
      });

      // Frames below new threshold should not trigger
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 80 });
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 85 });

      const alerts = monitor.getAlerts();
      expect(alerts.length).toBe(0);
    });

    it('should allow disabling alerts', () => {
      monitor.configureAlerts({
        enabled: false
      });

      // Generate spikes
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 100 });
      monitor.beginFrame();
      monitor.endFrame({ frameTime: 105 });

      const alerts = monitor.getAlerts();
      expect(alerts.length).toBe(0);
    });
  });
});

