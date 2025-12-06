// src/gpu/ShaderModuleCache.js
// GPU Shader Module Cache
// Caches compiled GPUShaderModule objects to avoid recompiling identical WGSL code

/**
 * Fast hash function (djb2 algorithm)
 * Synchronous operation - returns immediately
 * @param {string} str - String to hash
 * @returns {string} - Hexadecimal hash string
 */
function djb2Hash(str) {
  if (typeof str !== 'string') {
    throw new TypeError('hashWGSL: input must be a string');
  }
  
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive hex string
  return Math.abs(hash).toString(16);
}

/**
 * Hash WGSL source code
 * Uses djb2 (fast, synchronous) by default
 * @param {string} wgslCode - WGSL shader source code
 * @param {boolean} useCryptographic - If true, use SHA-256 (async), otherwise djb2 (sync)
 * @returns {Promise<string>|string} - Hash string
 */
export function hashWGSL(wgslCode, useCryptographic = false) {
  if (useCryptographic) {
    // SHA-256 implementation (async)
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      console.warn('[ShaderModuleCache] Web Crypto API not available, falling back to djb2');
      return djb2Hash(wgslCode);
    }
    
    const encoder = new TextEncoder();
    const data = encoder.encode(wgslCode);
    return crypto.subtle.digest('SHA-256', data).then(hashBuffer => {
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    });
  }
  
  // Use fast djb2 hash (synchronous)
  return djb2Hash(wgslCode);
}

/**
 * GPU Shader Module Cache
 * Caches compiled GPUShaderModule objects to avoid recompiling identical WGSL code
 * 
 * Map structure: wgslHash -> { module: GPUShaderModule, lastUsed: timestamp, useCount: number }
 */
export class ShaderModuleCache {
  constructor() {
    /**
     * Cache map: wgslHash -> { module, lastUsed, useCount }
     * @type {Map<string, {module: GPUShaderModule, lastUsed: number, useCount: number}>}
     */
    this.cache = new Map();
    
    /**
     * Total number of cache hits
     */
    this.hits = 0;
    
    /**
     * Total number of cache misses
     */
    this.misses = 0;
    
    /**
     * Whether to use cryptographic hashing (SHA-256) or fast hashing (djb2)
     */
    this.useCryptographicHash = false;
  }

  /**
   * Get a cached shader module by hash
   * Updates lastUsed timestamp and increments useCount
   * @param {string} hash - WGSL hash
   * @returns {GPUShaderModule|null} - Cached module or null if not found
   */
  get(hash) {
    const entry = this.cache.get(hash);
    if (entry) {
      entry.lastUsed = performance.now();
      entry.useCount++;
      this.hits++;
      return entry.module;
    }
    this.misses++;
    return null;
  }

  /**
   * Store a shader module in the cache
   * @param {string} hash - WGSL hash
   * @param {GPUShaderModule} module - Compiled GPUShaderModule
   */
  set(hash, module) {
    if (!hash || !module) {
      console.warn('[ShaderModuleCache] Invalid hash or module provided');
      return;
    }

    const now = performance.now();
    this.cache.set(hash, {
      module,
      lastUsed: now,
      useCount: 1
    });
  }

  /**
   * Clear all cached shader modules
   * Note: GPUShaderModule objects are automatically garbage collected
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    console.log(`[ShaderModuleCache] Cleared ${size} cached shader modules`);
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getStats() {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? (this.hits / totalRequests * 100).toFixed(2) : 0;
    
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      totalRequests,
      hitRate: `${hitRate}%`,
      entries: Array.from(this.cache.entries()).map(([hash, entry]) => ({
        hash: hash.substring(0, 16) + '...', // Truncate hash for display
        useCount: entry.useCount,
        lastUsed: entry.lastUsed,
        ageMs: performance.now() - entry.lastUsed
      }))
    };
  }

  /**
   * Remove a specific entry from the cache
   * @param {string} hash - WGSL hash to remove
   * @returns {boolean} - True if entry was removed, false if not found
   */
  delete(hash) {
    return this.cache.delete(hash);
  }

  /**
   * Get or create a shader module, caching it automatically
   * This is a convenience method that combines hashing, checking cache, and creating/storing
   * @param {GPUDevice} device - WebGPU device
   * @param {string} wgslCode - WGSL source code
   * @returns {Promise<GPUShaderModule>|GPUShaderModule} - Cached or newly created shader module
   */
  async getOrCreate(device, wgslCode) {
    if (!device || !wgslCode) {
      throw new Error('[ShaderModuleCache] Device and WGSL code are required');
    }

    // Hash the WGSL code (may be sync or async depending on useCryptographicHash)
    const hash = await hashWGSL(wgslCode, this.useCryptographicHash);
    
    // Check cache first
    const cached = this.get(hash);
    if (cached) {
      return cached;
    }

    // Create new shader module
    const module = device.createShaderModule({ code: wgslCode });
    
    // Store in cache
    this.set(hash, module);
    
    return module;
  }

  /**
   * Set whether to use cryptographic hashing
   * @param {boolean} useCryptographic - If true, use SHA-256, otherwise djb2
   */
  setUseCryptographicHash(useCryptographic) {
    this.useCryptographicHash = useCryptographic;
  }
}

// Export a singleton instance for convenience
export const shaderModuleCache = new ShaderModuleCache();
