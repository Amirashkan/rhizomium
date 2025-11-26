// src/core/InvalidationManager.js
/**
 * Precise Invalidation Manager
 * 
 * Tracks dirty regions by node/region and provides region merging capabilities
 * to minimize redraw operations.
 */

/**
 * Represents a rectangular region in world coordinates
 * @typedef {Object} Region
 * @property {number} x - Left coordinate
 * @property {number} y - Top coordinate
 * @property {number} w - Width
 * @property {number} h - Height
 */

/**
 * Invalidation entry tracking a dirty region
 * @typedef {Object} InvalidationEntry
 * @property {Region} region - The dirty region
 * @property {string} reason - Reason for invalidation (for debugging)
 * @property {number} timestamp - When the region was marked dirty
 * @property {string|number} key - Node ID or region identifier
 */

export class InvalidationManager {
  constructor() {
    /**
     * Map of invalidation entries keyed by node ID or region name
     * @type {Map<string|number, InvalidationEntry>}
     */
    this._invalidations = new Map();
    
    /**
     * Merged dirty regions (computed lazily)
     * @type {Region[]}
     */
    this._mergedRegions = null;
    
    /**
     * Whether merged regions need recomputation
     * @type {boolean}
     */
    this._needsMerge = false;
    
    /**
     * Maximum number of regions before forcing a full redraw
     * @type {number}
     */
    this._maxRegions = 50;
    
    /**
     * Padding to add around node regions for connections/pins
     * @type {number}
     */
    this._regionPadding = 20;
  }

  /**
   * Mark a region as dirty
   * @param {string|number} key - Node ID or region identifier
   * @param {Region} region - The region to invalidate
   * @param {string} reason - Reason for invalidation (optional)
   */
  invalidate(key, region, reason = 'unknown') {
    if (!region || !Number.isFinite(region.x) || !Number.isFinite(region.y) ||
        !Number.isFinite(region.w) || !Number.isFinite(region.h)) {
      // Invalid region, mark as full invalidation
      this.invalidateFull(reason);
      return;
    }

    // Add padding to region
    const paddedRegion = {
      x: region.x - this._regionPadding,
      y: region.y - this._regionPadding,
      w: region.w + (this._regionPadding * 2),
      h: region.h + (this._regionPadding * 2)
    };

    // Normalize region (ensure positive dimensions)
    const normalized = this._normalizeRegion(paddedRegion);

    const timestamp = this._getTimestamp();
    
    // Check if we already have an invalidation for this key
    const existing = this._invalidations.get(key);
    if (existing) {
      // Merge with existing region
      existing.region = this._mergeRegions(existing.region, normalized);
      existing.reason = `${existing.reason}, ${reason}`;
      existing.timestamp = timestamp;
    } else {
      // Create new entry
      this._invalidations.set(key, {
        region: normalized,
        reason,
        timestamp,
        key
      });
    }

    this._needsMerge = true;
  }

  /**
   * Mark a node region as dirty
   * @param {Object} node - Node object with x, y, w, h properties
   * @param {string} reason - Reason for invalidation (optional)
   */
  invalidateNode(node, reason = 'node-update') {
    if (!node || !node.id) {
      return;
    }

    const region = {
      x: node.x || 0,
      y: node.y || 0,
      w: node.w || 120,
      h: node.h || 80
    };

    this.invalidate(node.id, region, reason);
  }

  /**
   * Mark multiple nodes as dirty
   * @param {Object[]} nodes - Array of node objects
   * @param {string} reason - Reason for invalidation (optional)
   */
  invalidateNodes(nodes, reason = 'nodes-update') {
    if (!Array.isArray(nodes)) {
      return;
    }

    for (const node of nodes) {
      this.invalidateNode(node, reason);
    }
  }

  /**
   * Mark a connection region as dirty (region between two nodes)
   * @param {Object} connection - Connection object with from/to node references
   * @param {Object} fromNode - Source node
   * @param {Object} toNode - Target node
   * @param {string} reason - Reason for invalidation (optional)
   */
  invalidateConnection(connection, fromNode, toNode, reason = 'connection-update') {
    if (!fromNode || !toNode) {
      return;
    }

    // Calculate bounding box that includes both nodes and the connection path
    const minX = Math.min(fromNode.x || 0, toNode.x || 0);
    const minY = Math.min(fromNode.y || 0, toNode.y || 0);
    const maxX = Math.max(
      (fromNode.x || 0) + (fromNode.w || 120),
      (toNode.x || 0) + (toNode.w || 120)
    );
    const maxY = Math.max(
      (fromNode.y || 0) + (fromNode.h || 80),
      (toNode.y || 0) + (toNode.h || 80)
    );

    const region = {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY
    };

    const key = `connection_${connection.from?.nodeId}_${connection.to?.nodeId}`;
    this.invalidate(key, region, reason);
  }

  /**
   * Mark the entire canvas as dirty
   * @param {string} reason - Reason for invalidation (optional)
   */
  invalidateFull(reason = 'full-invalidation') {
    this._invalidations.clear();
    this._invalidations.set('__full__', {
      region: null, // null means full canvas
      reason,
      timestamp: this._getTimestamp(),
      key: '__full__'
    });
    this._needsMerge = true;
  }

  /**
   * Get all dirty regions (merged)
   * @returns {Region[]|null} Array of merged regions, or null for full redraw
   */
  getDirtyRegions() {
    if (this._invalidations.size === 0) {
      return [];
    }

    // Check for full invalidation
    if (this._invalidations.has('__full__')) {
      return null; // null means full redraw
    }

    // Recompute merged regions if needed
    if (this._needsMerge || !this._mergedRegions) {
      this._mergedRegions = this._computeMergedRegions();
      this._needsMerge = false;
    }

    return this._mergedRegions;
  }

  /**
   * Check if any regions are dirty
   * @returns {boolean}
   */
  hasDirtyRegions() {
    return this._invalidations.size > 0;
  }

  /**
   * Check if full redraw is needed
   * @returns {boolean}
   */
  needsFullRedraw() {
    return this._invalidations.has('__full__');
  }

  /**
   * Clear all invalidations
   */
  clear() {
    this._invalidations.clear();
    this._mergedRegions = null;
    this._needsMerge = false;
  }

  /**
   * Clear invalidations for specific keys
   * @param {Array<string|number>} keys - Keys to clear
   */
  clearKeys(keys) {
    for (const key of keys) {
      this._invalidations.delete(key);
    }
    this._needsMerge = true;
  }

  /**
   * Get debug information about invalidations
   * @returns {Object}
   */
  getDebugInfo() {
    const entries = Array.from(this._invalidations.values());
    return {
      count: entries.length,
      needsFullRedraw: this.needsFullRedraw(),
      mergedRegionCount: this._mergedRegions ? this._mergedRegions.length : 0,
      entries: entries.map(e => ({
        key: e.key,
        reason: e.reason,
        region: e.region,
        timestamp: e.timestamp
      }))
    };
  }

  /**
   * Compute merged regions from all invalidations
   * @private
   * @returns {Region[]}
   */
  _computeMergedRegions() {
    const regions = Array.from(this._invalidations.values())
      .map(entry => entry.region)
      .filter(region => region !== null);

    if (regions.length === 0) {
      return [];
    }

    // If we have too many regions, it's more efficient to do a full redraw
    if (regions.length > this._maxRegions) {
      return null; // Signal full redraw
    }

    // Merge overlapping regions
    return this._mergeOverlappingRegions(regions);
  }

  /**
   * Merge overlapping regions into a minimal set
   * @private
   * @param {Region[]} regions - Array of regions to merge
   * @returns {Region[]} Merged regions
   */
  _mergeOverlappingRegions(regions) {
    if (regions.length === 0) {
      return [];
    }

    if (regions.length === 1) {
      return [regions[0]];
    }

    // Use a simple greedy merging algorithm
    let merged = [regions[0]];
    
    for (let i = 1; i < regions.length; i++) {
      const current = regions[i];
      let mergedIntoExisting = false;

      // Try to merge with existing merged regions
      for (let j = 0; j < merged.length; j++) {
        if (this._regionsOverlap(merged[j], current)) {
          merged[j] = this._mergeRegions(merged[j], current);
          mergedIntoExisting = true;
          break;
        }
      }

      // If couldn't merge, add as new region
      if (!mergedIntoExisting) {
        merged.push(current);
      }
    }

    // Continue merging until no more overlaps
    let changed = true;
    while (changed && merged.length > 1) {
      changed = false;
      const newMerged = [merged[0]];

      for (let i = 1; i < merged.length; i++) {
        const current = merged[i];
        let mergedIntoExisting = false;

        for (let j = 0; j < newMerged.length; j++) {
          if (this._regionsOverlap(newMerged[j], current)) {
            newMerged[j] = this._mergeRegions(newMerged[j], current);
            mergedIntoExisting = true;
            changed = true;
            break;
          }
        }

        if (!mergedIntoExisting) {
          newMerged.push(current);
        }
      }

      merged = newMerged;
    }

    return merged;
  }

  /**
   * Check if two regions overlap
   * @private
   * @param {Region} a - First region
   * @param {Region} b - Second region
   * @returns {boolean}
   */
  _regionsOverlap(a, b) {
    return !(
      a.x + a.w < b.x ||
      b.x + b.w < a.x ||
      a.y + a.h < b.y ||
      b.y + b.h < a.y
    );
  }

  /**
   * Merge two regions into a bounding box
   * @private
   * @param {Region} a - First region
   * @param {Region} b - Second region
   * @returns {Region}
   */
  _mergeRegions(a, b) {
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x + a.w, b.x + b.w);
    const maxY = Math.max(a.y + a.h, b.y + b.h);

    return {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY
    };
  }

  /**
   * Normalize a region (ensure positive dimensions)
   * @private
   * @param {Region} region - Region to normalize
   * @returns {Region}
   */
  _normalizeRegion(region) {
    let x = region.x;
    let y = region.y;
    let w = region.w;
    let h = region.h;

    // Handle negative widths/heights
    if (w < 0) {
      x += w;
      w = Math.abs(w);
    }
    if (h < 0) {
      y += h;
      h = Math.abs(h);
    }

    return { x, y, w, h };
  }

  /**
   * Get current timestamp
   * @private
   * @returns {number}
   */
  _getTimestamp() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  /**
   * Set region padding
   * @param {number} padding - Padding in pixels
   */
  setRegionPadding(padding) {
    this._regionPadding = Math.max(0, padding);
  }

  /**
   * Set maximum number of regions before forcing full redraw
   * @param {number} max - Maximum number of regions
   */
  setMaxRegions(max) {
    this._maxRegions = Math.max(1, max);
  }
}

