// tests/RenderCache.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RenderCache } from '../src/gpu/RenderCache.js';

// Mock WebGPU device
class MockGPUDevice {
  constructor() {
    this.textures = new Set();
  }
}

class MockTexture {
  constructor() {
    this.destroyed = false;
  }
  destroy() {
    this.destroyed = true;
  }
}

describe('RenderCache', () => {
  let cache;
  let mockDevice;

  beforeEach(() => {
    mockDevice = new MockGPUDevice();
    cache = new RenderCache(mockDevice, {
      maxMemoryMB: 10, // Small limit for testing
      maxEntries: 5
    });
  });

  afterEach(() => {
    cache.clear();
  });

  describe('Basic Caching', () => {
    it('should create texture on cache miss', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      const texture = cache.getOrCreateTexture('key1', metadata, createFn);
      
      expect(createFn).toHaveBeenCalledTimes(1);
      expect(texture).toBeInstanceOf(MockTexture);
      expect(cache.hasKey('key1')).toBe(true);
    });

    it('should return cached texture on cache hit', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      const texture1 = cache.getOrCreateTexture('key1', metadata, createFn);
      const texture2 = cache.getOrCreateTexture('key1', metadata, createFn);
      
      expect(createFn).toHaveBeenCalledTimes(1);
      expect(texture1).toBe(texture2);
    });

    it('should track cache hits and misses', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.getOrCreateTexture('key1', metadata, createFn);
      cache.getOrCreateTexture('key1', metadata, createFn);
      cache.getOrCreateTexture('key2', metadata, createFn);
      
      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBe(2);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used entries when limit reached', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      // Fill cache to limit
      for (let i = 0; i < 5; i++) {
        cache.getOrCreateTexture(`key${i}`, metadata, createFn);
      }
      
      expect(cache.getMetrics().entries).toBe(5);
      
      // Access first key to make it recently used
      cache.getOrCreateTexture('key0', metadata, createFn);
      
      // Add new entry - should evict key1 (least recently used)
      cache.getOrCreateTexture('key5', metadata, createFn);
      
      expect(cache.getMetrics().entries).toBe(5);
      expect(cache.hasKey('key0')).toBe(true);
      expect(cache.hasKey('key5')).toBe(true);
      expect(cache.hasKey('key1')).toBe(false); // Should be evicted
    });

    it('should evict based on memory limit', () => {
      const createFn = vi.fn(() => new MockTexture());
      
      // Create large textures
      const largeMetadata = { width: 1000, height: 1000 };
      
      // First texture should fit
      cache.getOrCreateTexture('key1', largeMetadata, createFn);
      expect(cache.hasKey('key1')).toBe(true);
      
      // Add more until memory limit
      cache.getOrCreateTexture('key2', largeMetadata, createFn);
      cache.getOrCreateTexture('key3', largeMetadata, createFn);
      
      // Should evict old entries when adding new ones
      const metrics = cache.getMetrics();
      expect(metrics.evictions).toBeGreaterThan(0);
    });
  });

  describe('Node Invalidation', () => {
    it('should invalidate all entries for a node', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.getOrCreateTexture('key1', metadata, createFn, { nodeId: 'node1' });
      cache.getOrCreateTexture('key2', metadata, createFn, { nodeId: 'node1' });
      cache.getOrCreateTexture('key3', metadata, createFn, { nodeId: 'node2' });
      
      expect(cache.hasKey('key1')).toBe(true);
      expect(cache.hasKey('key2')).toBe(true);
      expect(cache.hasKey('key3')).toBe(true);
      
      cache.invalidateNode('node1');
      
      expect(cache.hasKey('key1')).toBe(false);
      expect(cache.hasKey('key2')).toBe(false);
      expect(cache.hasKey('key3')).toBe(true); // node2 should remain
      
      const metrics = cache.getMetrics();
      expect(metrics.invalidations).toBe(2);
    });

    it('should not invalidate static nodes', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.getOrCreateTexture('key1', metadata, createFn, { 
        nodeId: 'node1', 
        static: true 
      });
      
      cache.markStatic('node1');
      cache.invalidateNode('node1');
      
      expect(cache.hasKey('key1')).toBe(true); // Should not be invalidated
    });

    it('should force invalidate static nodes', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.getOrCreateTexture('key1', metadata, createFn, { 
        nodeId: 'node1', 
        static: true 
      });
      
      cache.markStatic('node1');
      cache.forceInvalidateNode('node1');
      
      expect(cache.hasKey('key1')).toBe(false); // Should be invalidated
    });
  });

  describe('Key Invalidation', () => {
    it('should invalidate specific key', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.getOrCreateTexture('key1', metadata, createFn);
      cache.getOrCreateTexture('key2', metadata, createFn);
      
      cache.invalidateKey('key1');
      
      expect(cache.hasKey('key1')).toBe(false);
      expect(cache.hasKey('key2')).toBe(true);
    });
  });

  describe('Lifetime Management', () => {
    it('should invalidate expired entries', () => {
      vi.useFakeTimers();
      
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.getOrCreateTexture('key1', metadata, createFn, { 
        lifetime: 1000 // 1 second
      });
      
      expect(cache.hasKey('key1')).toBe(true);
      
      // Advance time past lifetime
      vi.advanceTimersByTime(1100);
      
      // Cleanup expired entries
      cache.cleanup();
      
      expect(cache.hasKey('key1')).toBe(false);
      
      vi.useRealTimers();
    });
  });

  describe('Framebuffer Caching', () => {
    it('should cache framebuffers', () => {
      const createFn = vi.fn(() => ({
        texture: new MockTexture(),
        framebuffer: {}
      }));
      const metadata = { width: 100, height: 100 };
      
      const result1 = cache.getOrCreateFramebuffer('fb1', metadata, createFn);
      const result2 = cache.getOrCreateFramebuffer('fb1', metadata, createFn);
      
      expect(createFn).toHaveBeenCalledTimes(1);
      expect(result1).toBe(result2);
    });
  });

  describe('Metrics', () => {
    it('should calculate hit rate correctly', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.getOrCreateTexture('key1', metadata, createFn);
      cache.getOrCreateTexture('key1', metadata, createFn); // Hit
      cache.getOrCreateTexture('key1', metadata, createFn); // Hit
      cache.getOrCreateTexture('key2', metadata, createFn); // Miss
      
      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(2);
      expect(metrics.misses).toBe(2);
      expect(metrics.hitRate).toBe('50.00%');
    });

    it('should track memory usage', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.getOrCreateTexture('key1', metadata, createFn);
      
      const metrics = cache.getMetrics();
      expect(metrics.totalMemoryMB).toBeGreaterThan(0);
    });
  });

  describe('Clear Operations', () => {
    it('should clear all cache entries', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.getOrCreateTexture('key1', metadata, createFn);
      cache.getOrCreateTexture('key2', metadata, createFn);
      
      expect(cache.getMetrics().entries).toBe(2);
      
      cache.clear();
      
      expect(cache.getMetrics().entries).toBe(0);
      expect(cache.hasKey('key1')).toBe(false);
      expect(cache.hasKey('key2')).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should respect max memory limit', () => {
      const createFn = vi.fn(() => new MockTexture());
      
      cache.setMaxMemory(1); // 1MB limit
      
      // Add a small texture first
      const smallMetadata = { width: 100, height: 100 };
      cache.getOrCreateTexture('key1', smallMetadata, createFn);
      
      // Add a large texture that would exceed limit - should evict the small one
      const largeMetadata = { width: 1000, height: 1000 };
      cache.getOrCreateTexture('key2', largeMetadata, createFn);
      
      // The large texture alone exceeds 1MB, so it will be the only entry
      // But we should verify eviction happened (key1 should be gone)
      expect(cache.hasKey('key1')).toBe(false);
      expect(cache.hasKey('key2')).toBe(true);
      
      // Memory should reflect only the large texture (which exceeds limit, but that's allowed for single entries)
      const metrics = cache.getMetrics();
      expect(metrics.entries).toBe(1);
    });

    it('should respect max entries limit', () => {
      const createFn = vi.fn(() => new MockTexture());
      const metadata = { width: 100, height: 100 };
      
      cache.setMaxEntries(3);
      
      for (let i = 0; i < 5; i++) {
        cache.getOrCreateTexture(`key${i}`, metadata, createFn);
      }
      
      expect(cache.getMetrics().entries).toBeLessThanOrEqual(3);
    });
  });
});

