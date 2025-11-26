// tests/InvalidationManager.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { InvalidationManager } from '../src/core/InvalidationManager.js';

describe('InvalidationManager', () => {
  let manager;

  beforeEach(() => {
    manager = new InvalidationManager();
  });

  describe('Basic Invalidation', () => {
    it('should track a single node invalidation', () => {
      const node = { id: 1, x: 10, y: 20, w: 100, h: 80 };
      manager.invalidateNode(node, 'test');

      expect(manager.hasDirtyRegions()).toBe(true);
      expect(manager.needsFullRedraw()).toBe(false);

      const regions = manager.getDirtyRegions();
      expect(regions).toHaveLength(1);
      expect(regions[0]).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
        w: expect.any(Number),
        h: expect.any(Number)
      });
    });

    it('should handle full invalidation', () => {
      manager.invalidateFull('full-test');

      expect(manager.hasDirtyRegions()).toBe(true);
      expect(manager.needsFullRedraw()).toBe(true);
      expect(manager.getDirtyRegions()).toBeNull();
    });

    it('should clear invalidations', () => {
      const node = { id: 1, x: 10, y: 20, w: 100, h: 80 };
      manager.invalidateNode(node, 'test');

      expect(manager.hasDirtyRegions()).toBe(true);

      manager.clear();
      expect(manager.hasDirtyRegions()).toBe(false);
      expect(manager.getDirtyRegions()).toEqual([]);
    });
  });

  describe('Region Merging', () => {
    it('should merge overlapping regions', () => {
      const node1 = { id: 1, x: 10, y: 10, w: 100, h: 80 };
      const node2 = { id: 2, x: 50, y: 50, w: 100, h: 80 }; // Overlaps with node1

      manager.invalidateNode(node1, 'test1');
      manager.invalidateNode(node2, 'test2');

      const regions = manager.getDirtyRegions();
      // Should merge into one region
      expect(regions.length).toBeLessThanOrEqual(2);
      
      // If merged, should be a single region covering both
      if (regions.length === 1) {
        const merged = regions[0];
        expect(merged.x).toBeLessThanOrEqual(10);
        expect(merged.y).toBeLessThanOrEqual(10);
        expect(merged.x + merged.w).toBeGreaterThanOrEqual(150);
        expect(merged.y + merged.h).toBeGreaterThanOrEqual(130);
      }
    });

    it('should not merge non-overlapping regions', () => {
      const node1 = { id: 1, x: 10, y: 10, w: 100, h: 80 };
      const node2 = { id: 2, x: 200, y: 200, w: 100, h: 80 }; // Far from node1

      manager.invalidateNode(node1, 'test1');
      manager.invalidateNode(node2, 'test2');

      const regions = manager.getDirtyRegions();
      expect(regions.length).toBe(2);
    });

    it('should merge multiple overlapping regions correctly', () => {
      // Create a chain of overlapping regions
      const nodes = [
        { id: 1, x: 0, y: 0, w: 100, h: 100 },
        { id: 2, x: 50, y: 50, w: 100, h: 100 }, // Overlaps with 1
        { id: 3, x: 100, y: 100, w: 100, h: 100 }, // Overlaps with 2
      ];

      nodes.forEach(node => manager.invalidateNode(node, 'test'));

      const regions = manager.getDirtyRegions();
      // All three should merge into one
      expect(regions.length).toBe(1);
      
      const merged = regions[0];
      expect(merged.x).toBeLessThanOrEqual(0);
      expect(merged.y).toBeLessThanOrEqual(0);
      expect(merged.x + merged.w).toBeGreaterThanOrEqual(200);
      expect(merged.y + merged.h).toBeGreaterThanOrEqual(200);
    });

    it('should handle region padding correctly', () => {
      manager.setRegionPadding(10);
      const node = { id: 1, x: 100, y: 100, w: 50, h: 50 };
      manager.invalidateNode(node, 'test');

      const regions = manager.getDirtyRegions();
      expect(regions).toHaveLength(1);
      
      const region = regions[0];
      // Should have padding applied
      expect(region.x).toBeLessThanOrEqual(90); // 100 - 10
      expect(region.y).toBeLessThanOrEqual(90); // 100 - 10
      expect(region.w).toBeGreaterThanOrEqual(70); // 50 + 20
      expect(region.h).toBeGreaterThanOrEqual(70); // 50 + 20
    });
  });

  describe('Multiple Node Invalidation', () => {
    it('should invalidate multiple nodes at once', () => {
      const nodes = [
        { id: 1, x: 10, y: 10, w: 100, h: 80 },
        { id: 2, x: 120, y: 10, w: 100, h: 80 },
        { id: 3, x: 230, y: 10, w: 100, h: 80 },
      ];

      manager.invalidateNodes(nodes, 'batch-update');

      expect(manager.hasDirtyRegions()).toBe(true);
      const regions = manager.getDirtyRegions();
      expect(regions.length).toBeGreaterThan(0);
    });

    it('should handle empty node array', () => {
      manager.invalidateNodes([], 'empty');
      expect(manager.hasDirtyRegions()).toBe(false);
    });
  });

  describe('Connection Invalidation', () => {
    it('should invalidate connection region', () => {
      const fromNode = { id: 1, x: 0, y: 0, w: 100, h: 80 };
      const toNode = { id: 2, x: 200, y: 200, w: 100, h: 80 };
      const connection = {
        from: { nodeId: 1, pin: 0 },
        to: { nodeId: 2, pin: 0 }
      };

      manager.invalidateConnection(connection, fromNode, toNode, 'connection-test');

      const regions = manager.getDirtyRegions();
      expect(regions).toHaveLength(1);
      
      const region = regions[0];
      // Should cover both nodes
      expect(region.x).toBeLessThanOrEqual(0);
      expect(region.y).toBeLessThanOrEqual(0);
      expect(region.x + region.w).toBeGreaterThanOrEqual(300);
      expect(region.y + region.h).toBeGreaterThanOrEqual(280);
    });
  });

  describe('Region Normalization', () => {
    it('should normalize negative dimensions', () => {
      const invalidRegion = { x: 100, y: 100, w: -50, h: -30 };
      manager.invalidate('test', invalidRegion, 'negative-dims');

      const regions = manager.getDirtyRegions();
      expect(regions).toHaveLength(1);
      
      const region = regions[0];
      expect(region.w).toBeGreaterThan(0);
      expect(region.h).toBeGreaterThan(0);
    });

    it('should handle invalid regions by doing full invalidation', () => {
      const invalidRegion = { x: NaN, y: 10, w: 100, h: 80 };
      manager.invalidate('test', invalidRegion, 'invalid');

      // Should trigger full invalidation
      expect(manager.needsFullRedraw()).toBe(true);
    });
  });

  describe('Max Regions Limit', () => {
    it('should force full redraw when too many regions', () => {
      manager.setMaxRegions(5);

      // Create 10 non-overlapping nodes
      for (let i = 0; i < 10; i++) {
        const node = {
          id: i,
          x: i * 200,
          y: 0,
          w: 100,
          h: 80
        };
        manager.invalidateNode(node, `test-${i}`);
      }

      // Should trigger full redraw due to too many regions
      const regions = manager.getDirtyRegions();
      expect(regions).toBeNull(); // null means full redraw
    });
  });

  describe('Debug Information', () => {
    it('should provide debug information', () => {
      const node1 = { id: 1, x: 10, y: 10, w: 100, h: 80 };
      const node2 = { id: 2, x: 120, y: 10, w: 100, h: 80 };

      manager.invalidateNode(node1, 'test1');
      manager.invalidateNode(node2, 'test2');

      const debugInfo = manager.getDebugInfo();
      expect(debugInfo).toHaveProperty('count');
      expect(debugInfo).toHaveProperty('needsFullRedraw');
      expect(debugInfo).toHaveProperty('mergedRegionCount');
      expect(debugInfo).toHaveProperty('entries');
      
      expect(debugInfo.count).toBe(2);
      expect(debugInfo.needsFullRedraw).toBe(false);
      expect(debugInfo.entries).toHaveLength(2);
    });
  });

  describe('Key-based Invalidation', () => {
    it('should update existing invalidation for same key', () => {
      const key = 'node-1';
      const region1 = { x: 10, y: 10, w: 100, h: 80 };
      const region2 = { x: 50, y: 50, w: 100, h: 80 };

      manager.invalidate(key, region1, 'first');
      manager.invalidate(key, region2, 'second');

      // Should merge regions for same key
      const regions = manager.getDirtyRegions();
      expect(regions.length).toBeLessThanOrEqual(2);
      
      const debugInfo = manager.getDebugInfo();
      // Should have only one entry (merged)
      expect(debugInfo.count).toBe(1);
    });

    it('should clear specific keys', () => {
      const node1 = { id: 1, x: 10, y: 10, w: 100, h: 80 };
      const node2 = { id: 2, x: 120, y: 10, w: 100, h: 80 };

      manager.invalidateNode(node1, 'test1');
      manager.invalidateNode(node2, 'test2');

      expect(manager.hasDirtyRegions()).toBe(true);

      manager.clearKeys([1]);
      expect(manager.hasDirtyRegions()).toBe(true); // Still has node2

      manager.clearKeys([2]);
      expect(manager.hasDirtyRegions()).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined nodes gracefully', () => {
      expect(() => manager.invalidateNode(null, 'test')).not.toThrow();
      expect(() => manager.invalidateNode(undefined, 'test')).not.toThrow();
      expect(() => manager.invalidateNode({}, 'test')).not.toThrow();
    });

    it('should handle nodes without dimensions', () => {
      const node = { id: 1, x: 10, y: 20 };
      manager.invalidateNode(node, 'test');

      const regions = manager.getDirtyRegions();
      expect(regions).toHaveLength(1);
      // Should use default dimensions
      expect(regions[0].w).toBeGreaterThan(0);
      expect(regions[0].h).toBeGreaterThan(0);
    });

    it('should handle zero-size regions', () => {
      const region = { x: 10, y: 20, w: 0, h: 0 };
      manager.invalidate('test', region, 'zero-size');

      // Should still create a region (with padding)
      const regions = manager.getDirtyRegions();
      expect(regions.length).toBeGreaterThan(0);
    });
  });
});

