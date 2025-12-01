/**
 * RenderCache
 * 
 * Caches intermediate render artifacts (textures, framebuffers) to avoid full rerenders.
 * Integrates with InvalidationManager for cache invalidation.
 * 
 * Features:
 * - LRU eviction to prevent memory bloat
 * - Metrics hooks for cache hit/miss tracking
 * - Automatic invalidation on node/region changes
 * - Support for static node caching
 * 
 * Usage:
 * const cache = new RenderCache(device);
 * const texture = cache.getOrCreateTexture('node_1', { width: 512, height: 512 }, () => {
 *   return createTexture(...);
 * });
 */

export class RenderCache {
  constructor(device, options = {}) {
    this.device = device;
    
    // Cache storage: key -> { texture, framebuffer, lastAccess, size, metadata }
    this._cache = new Map();
    
    // LRU tracking: most recently used keys at the end
    this._lruKeys = [];
    
    // Configuration
    this._maxMemoryMB = options.maxMemoryMB || 256; // Default 256MB limit
    this._maxEntries = options.maxEntries || 100; // Max cache entries
    this._defaultLifetime = options.defaultLifetime || 60000; // 60 seconds default
    
    // Metrics
    this._metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0,
      totalMemoryMB: 0,
      peakMemoryMB: 0
    };
    
    // Invalidation callbacks: nodeId -> Set of cache keys
    this._nodeToKeys = new Map();
    
    // Static node tracking: nodes that don't change unless explicitly invalidated
    this._staticNodes = new Set();
    
    // Lifetime tracking: key -> expiration timestamp
    this._lifetimes = new Map();
  }

  /**
   * Get or create a cached texture
   * @param {string} key - Cache key (e.g., 'node_1_512x512')
   * @param {Object} metadata - Metadata for the texture (width, height, format, etc.)
   * @param {Function} createFn - Function to create the texture if not cached
   * @param {Object} options - Options (lifetime, static, nodeId)
   * @returns {GPUTexture} The cached or newly created texture
   */
  getOrCreateTexture(key, metadata, createFn, options = {}) {
    // Check if cached and valid
    const cached = this._cache.get(key);
    if (cached && this._isValid(key, cached)) {
      // Update LRU
      this._updateLRU(key);
      this._metrics.hits++;
      return cached.texture;
    }

    // Cache miss - create new texture
    this._metrics.misses++;
    
    // Check memory limits before creating
    this._evictIfNeeded(metadata);

    // Create texture
    const texture = createFn();
    if (!texture) {
      return null;
    }

    // Calculate size
    const size = this._calculateTextureSize(metadata);

    // Store in cache
    const entry = {
      texture,
      framebuffer: null, // Can be set separately
      lastAccess: this._getTime(),
      size,
      metadata: { ...metadata },
      nodeId: options.nodeId || null,
      static: options.static || false
    };

    this._cache.set(key, entry);
    this._updateLRU(key);
    this._updateLifetime(key, options.lifetime || this._defaultLifetime);
    this._updateMemoryMetrics();

    // Track node association for invalidation
    if (entry.nodeId) {
      if (!this._nodeToKeys.has(entry.nodeId)) {
        this._nodeToKeys.set(entry.nodeId, new Set());
      }
      this._nodeToKeys.get(entry.nodeId).add(key);
      
      if (entry.static) {
        this._staticNodes.add(entry.nodeId);
      }
    }

    return texture;
  }

  /**
   * Get or create a cached framebuffer (render target)
   * @param {string} key - Cache key
   * @param {Object} metadata - Metadata (width, height, format, etc.)
   * @param {Function} createFn - Function to create the framebuffer
   * @param {Object} options - Options
   * @returns {Object} { texture, framebuffer } or null
   */
  getOrCreateFramebuffer(key, metadata, createFn, options = {}) {
    const cached = this._cache.get(key);
    if (cached && cached.framebuffer && this._isValid(key, cached)) {
      this._updateLRU(key);
      this._metrics.hits++;
      // Return cached framebuffer object if it exists, otherwise create new one
      if (cached.cachedFramebufferObject) {
        return cached.cachedFramebufferObject;
      }
      const fbObject = {
        texture: cached.texture,
        framebuffer: cached.framebuffer
      };
      cached.cachedFramebufferObject = fbObject;
      return fbObject;
    }

    this._metrics.misses++;
    this._evictIfNeeded(metadata);

    const result = createFn();
    if (!result) {
      return null;
    }

    const size = this._calculateTextureSize(metadata);
    const entry = {
      texture: result.texture,
      framebuffer: result.framebuffer || null,
      lastAccess: this._getTime(),
      size,
      metadata: { ...metadata },
      nodeId: options.nodeId || null,
      static: options.static || false
    };

    this._cache.set(key, entry);
    this._updateLRU(key);
    this._updateLifetime(key, options.lifetime || this._defaultLifetime);
    this._updateMemoryMetrics();

    if (entry.nodeId) {
      if (!this._nodeToKeys.has(entry.nodeId)) {
        this._nodeToKeys.set(entry.nodeId, new Set());
      }
      this._nodeToKeys.get(entry.nodeId).add(key);
      
      if (entry.static) {
        this._staticNodes.add(entry.nodeId);
      }
    }

    // Cache the framebuffer object for consistent returns
    entry.cachedFramebufferObject = result;
    return result;
  }

  /**
   * Invalidate cache entries for a specific node
   * @param {string|number} nodeId - Node ID to invalidate
   * @param {string} reason - Reason for invalidation (for metrics)
   */
  invalidateNode(nodeId, reason = 'node-invalidation') {
    const keys = this._nodeToKeys.get(nodeId);
    if (!keys || keys.size === 0) {
      return;
    }

    // Don't invalidate static nodes unless explicitly requested
    if (this._staticNodes.has(nodeId)) {
      return;
    }

    // Save the count before iterating (since _invalidateKey removes keys from the Set)
    const invalidationCount = keys.size;
    
    // Create a copy of keys to iterate over, since we'll be modifying the Set
    const keysToInvalidate = Array.from(keys);
    
    for (const key of keysToInvalidate) {
      this._invalidateKey(key, reason);
    }

    // Clean up node tracking (should already be done by _invalidateKey, but ensure it)
    this._nodeToKeys.delete(nodeId);
    this._staticNodes.delete(nodeId);
    this._metrics.invalidations += invalidationCount;
  }

  /**
   * Invalidate a specific cache key
   * @param {string} key - Cache key to invalidate
   * @param {string} reason - Reason for invalidation
   */
  invalidateKey(key, reason = 'key-invalidation') {
    this._invalidateKey(key, reason);
    this._metrics.invalidations++;
  }

  /**
   * Mark a node as static (won't be invalidated automatically)
   * @param {string|number} nodeId - Node ID
   */
  markStatic(nodeId) {
    this._staticNodes.add(nodeId);
    
    // Mark all associated cache entries as static
    const keys = this._nodeToKeys.get(nodeId);
    if (keys) {
      for (const key of keys) {
        const entry = this._cache.get(key);
        if (entry) {
          entry.static = true;
        }
      }
    }
  }

  /**
   * Force invalidate a static node (e.g., when user explicitly changes it)
   * @param {string|number} nodeId - Node ID
   * @param {string} reason - Reason for invalidation
   */
  forceInvalidateNode(nodeId, reason = 'force-invalidation') {
    const keys = this._nodeToKeys.get(nodeId);
    if (!keys || keys.size === 0) {
      return;
    }

    for (const key of keys) {
      this._invalidateKey(key, reason);
    }

    this._nodeToKeys.delete(nodeId);
    this._staticNodes.delete(nodeId);
    this._metrics.invalidations += keys.size;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    for (const [key, entry] of this._cache) {
      this._destroyEntry(entry);
    }
    this._cache.clear();
    this._lruKeys = [];
    this._nodeToKeys.clear();
    this._staticNodes.clear();
    this._lifetimes.clear();
    this._metrics.totalMemoryMB = 0;
  }

  /**
   * Get cache metrics
   * @returns {Object} Metrics object
   */
  getMetrics() {
    const hitRate = this._metrics.hits + this._metrics.misses > 0
      ? (this._metrics.hits / (this._metrics.hits + this._metrics.misses)) * 100
      : 0;

    return {
      ...this._metrics,
      hitRate: hitRate.toFixed(2) + '%',
      entries: this._cache.size,
      staticNodes: this._staticNodes.size,
      peakMemoryMB: this._metrics.peakMemoryMB.toFixed(2)
    };
  }

  /**
   * Reset metrics (keeps cache intact)
   */
  resetMetrics() {
    this._metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0,
      totalMemoryMB: this._metrics.totalMemoryMB,
      peakMemoryMB: this._metrics.peakMemoryMB
    };
  }

  /**
   * Set maximum memory limit
   * @param {number} maxMemoryMB - Maximum memory in MB
   */
  setMaxMemory(maxMemoryMB) {
    this._maxMemoryMB = maxMemoryMB;
    // Evict entries that exceed the new limit
    this._updateMemoryMetrics();
    while (this._cache.size > 0 && this._metrics.totalMemoryMB > maxMemoryMB) {
      this._evictLRU();
      this._updateMemoryMetrics();
    }
  }

  /**
   * Set maximum cache entries
   * @param {number} maxEntries - Maximum number of entries
   */
  setMaxEntries(maxEntries) {
    this._maxEntries = maxEntries;
    while (this._cache.size > maxEntries) {
      this._evictLRU();
    }
  }

  // Private methods

  _isValid(key, entry) {
    // Check lifetime expiration
    const lifetime = this._lifetimes.get(key);
    if (lifetime && this._getTime() > lifetime) {
      return false;
    }

    // Check if texture is still valid (not destroyed)
    if (entry.texture && entry.texture.destroyed) {
      return false;
    }

    return true;
  }

  _updateLRU(key) {
    // Remove from current position
    const index = this._lruKeys.indexOf(key);
    if (index >= 0) {
      this._lruKeys.splice(index, 1);
    }
    // Add to end (most recently used)
    this._lruKeys.push(key);
    
    // Update last access time
    const entry = this._cache.get(key);
    if (entry) {
      entry.lastAccess = this._getTime();
    }
  }

  _updateLifetime(key, lifetimeMs) {
    if (lifetimeMs > 0) {
      this._lifetimes.set(key, this._getTime() + lifetimeMs);
    } else {
      this._lifetimes.delete(key);
    }
  }

  _calculateTextureSize(metadata) {
    const width = metadata.width || 1;
    const height = metadata.height || 1;
    const depth = metadata.depth || 1;
    const format = metadata.format || 'rgba8unorm';
    
    // Estimate bytes per pixel based on format
    let bytesPerPixel = 4; // Default RGBA8
    if (format.includes('16')) bytesPerPixel = 8;
    else if (format.includes('32')) bytesPerPixel = 16;
    else if (format.includes('r8')) bytesPerPixel = 1;
    else if (format.includes('rg8')) bytesPerPixel = 2;
    
    return (width * height * depth * bytesPerPixel) / (1024 * 1024); // MB
  }

  _evictIfNeeded(metadata) {
    const newEntrySize = this._calculateTextureSize(metadata);
    
    // Evict until we have enough space
    while (this._cache.size > 0) {
      // Update memory metrics before checking
      this._updateMemoryMetrics();
      const currentMemory = this._metrics.totalMemoryMB;
      
      // Check entry count limit
      if (this._cache.size >= this._maxEntries) {
        this._evictLRU();
        continue;
      }
      
      // Check memory limit - if new entry alone exceeds limit, still evict everything
      // but we'll allow it (can't prevent single large entries)
      if (currentMemory + newEntrySize > this._maxMemoryMB) {
        this._evictLRU();
        continue;
      }
      
      break;
    }
  }

  _evictLRU() {
    if (this._lruKeys.length === 0) {
      return;
    }

    // Evict least recently used (first in array)
    const keyToEvict = this._lruKeys[0];
    const entry = this._cache.get(keyToEvict);
    
    if (entry) {
      this._destroyEntry(entry);
      this._cache.delete(keyToEvict);
      this._lifetimes.delete(keyToEvict);
      
      // Remove from node tracking
      if (entry.nodeId) {
        const keys = this._nodeToKeys.get(entry.nodeId);
        if (keys) {
          keys.delete(keyToEvict);
          if (keys.size === 0) {
            this._nodeToKeys.delete(entry.nodeId);
            this._staticNodes.delete(entry.nodeId);
          }
        }
      }
      
      this._metrics.evictions++;
    }
    
    this._lruKeys.shift();
    this._updateMemoryMetrics();
  }

  _invalidateKey(key, reason) {
    const entry = this._cache.get(key);
    if (!entry) {
      return;
    }

    this._destroyEntry(entry);
    this._cache.delete(key);
    this._lifetimes.delete(key);
    
    // Remove from LRU
    const index = this._lruKeys.indexOf(key);
    if (index >= 0) {
      this._lruKeys.splice(index, 1);
    }
    
    // Remove from node tracking
    if (entry.nodeId) {
      const keys = this._nodeToKeys.get(entry.nodeId);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          this._nodeToKeys.delete(entry.nodeId);
          this._staticNodes.delete(entry.nodeId);
        }
      }
    }
    
    this._updateMemoryMetrics();
  }

  _destroyEntry(entry) {
    if (entry.texture && !entry.texture.destroyed) {
      try {
        entry.texture.destroy();
      } catch (err) {
        console.warn('[RenderCache] Error destroying texture:', err);
      }
    }
    
    // Note: WebGPU doesn't have explicit framebuffer objects,
    // but if we add them in the future, destroy them here
  }

  _updateMemoryMetrics() {
    let totalMB = 0;
    for (const entry of this._cache.values()) {
      totalMB += entry.size;
    }
    
    this._metrics.totalMemoryMB = totalMB;
    if (totalMB > this._metrics.peakMemoryMB) {
      this._metrics.peakMemoryMB = totalMB;
    }
  }

  /**
   * Clean up expired entries (call periodically)
   */
  cleanup() {
    const now = this._getTime();
    const expiredKeys = [];
    
    for (const [key, expiration] of this._lifetimes) {
      if (now > expiration) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this._invalidateKey(key, 'lifetime-expired');
    }
  }

  /**
   * Get current time - works with both real and fake timers
   * @private
   */
  _getTime() {
    // Use Date.now() which works with fake timers, fallback to performance.now()
    if (typeof Date !== 'undefined' && Date.now) {
      return Date.now();
    }
    return performance.now();
  }
  
  /**
   * Check if a key exists in the cache
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists
   */
  hasKey(key) {
    // Check if key exists in cache (validity is checked when actually using the entry)
    return this._cache.has(key);
  }
}

