// src/core/ViewportManager.js - Enhanced with ErrorHandler integration
import { canvasViewportWidth } from '../ui/dockLayout.js';

export class ViewportManager {
  constructor() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this._isPanning = false;
    this._panStart = null;
    
    // PERFORMANCE: Cache viewport calculations during panning
    // Only recalculate when panning stops or zoom changes
    this._viewportDirty = true;
    this._lastScale = this.scale;
    this._lastOffsetX = this.offsetX;
    this._lastOffsetY = this.offsetY;
    
    // Cache for screenToCanvas and canvasToScreen results
    // Key format: "screenToCanvas_${screenX}_${screenY}" or "canvasToScreen_${canvasX}_${canvasY}"
    this._transformCache = new Map();
    this._cacheMaxSize = 1000; // Limit cache size to prevent memory issues
    
    // Track pan velocity for fast pan detection
    this._panVelocity = { x: 0, y: 0 };
    this._lastPanTime = 0;
    this._lastPanPos = { x: 0, y: 0 };
  }

  startPan(clientX, clientY) {
    try {
      if (typeof clientX !== 'number' || typeof clientY !== 'number') {
        throw new Error('Invalid coordinates for pan start');
      }

      this._isPanning = true;
      this._panStart = {
        x: clientX,
        y: clientY,
        ox: this.offsetX,
        oy: this.offsetY,
      };
      
      // PERFORMANCE: Mark viewport as dirty and clear cache when panning starts
      this._viewportDirty = true;
      this._lastPanTime = performance.now();
      this._lastPanPos = { x: clientX, y: clientY };
      this._panVelocity = { x: 0, y: 0 };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-pan-start',
        coordinates: { clientX, clientY }
      });
      // Reset state on error
      this._isPanning = false;
      this._panStart = null;
    }
  }

  updatePan(clientX, clientY) {
    try {
      if (!this._isPanning || !this._panStart) return false;

      if (typeof clientX !== 'number' || typeof clientY !== 'number') {
        throw new Error('Invalid coordinates for pan update');
      }

      const dx = clientX - this._panStart.x;
      const dy = clientY - this._panStart.y;
      const newOffsetX = this._panStart.ox + dx;
      const newOffsetY = this._panStart.oy + dy;
      
      // PERFORMANCE: Track pan velocity for fast pan detection
      const now = performance.now();
      const dt = now - this._lastPanTime;
      if (dt > 0) {
        const dxVel = clientX - this._lastPanPos.x;
        const dyVel = clientY - this._lastPanPos.y;
        this._panVelocity = {
          x: dxVel / dt,
          y: dyVel / dt
        };
      }
      this._lastPanTime = now;
      this._lastPanPos = { x: clientX, y: clientY };
      
      // PERFORMANCE: Only mark dirty if offset actually changed
      // This allows caching within the same frame
      const offsetChanged = this.offsetX !== newOffsetX || this.offsetY !== newOffsetY;
      this.offsetX = newOffsetX;
      this.offsetY = newOffsetY;
      
      if (offsetChanged) {
        // Clear cache when offset changes
        this._clearTransformCache();
        this._viewportDirty = true;
      }
      
      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-pan-update',
        coordinates: { clientX, clientY },
        isPanning: this._isPanning,
        hasPanStart: !!this._panStart
      });
      return false;
    }
  }

  stopPan() {
    try {
      this._isPanning = false;
      this._panStart = null;
      
      // PERFORMANCE: Clear transform cache when panning stops
      // This ensures fresh calculations after panning
      this._clearTransformCache();
      this._viewportDirty = true;
      this._lastScale = this.scale;
      this._lastOffsetX = this.offsetX;
      this._lastOffsetY = this.offsetY;
      this._panVelocity = { x: 0, y: 0 };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-pan-stop'
      });
    }
  }

  zoom(mouseX, mouseY, delta) {
    try {
      if (typeof mouseX !== 'number' || typeof mouseY !== 'number' || typeof delta !== 'number') {
        throw new Error('Invalid parameters for zoom operation');
      }

      if (!isFinite(mouseX) || !isFinite(mouseY) || !isFinite(delta)) {
        throw new Error('Non-finite values in zoom parameters');
      }

      const prev = this.scale;
      const step = 1 + -Math.sign(delta) * 0.1;
      const next = Math.min(2.5, Math.max(0.25, prev * step));

      if (next === prev) return false;

      const k = next / prev;
      const newOffsetX = mouseX - (mouseX - this.offsetX) * k;
      const newOffsetY = mouseY - (mouseY - this.offsetY) * k;

      // Validate calculated values
      if (!isFinite(newOffsetX) || !isFinite(newOffsetY) || !isFinite(next)) {
        throw new Error('Invalid zoom calculation results');
      }

      this.offsetX = newOffsetX;
      this.offsetY = newOffsetY;
      this.scale = next;
      
      // PERFORMANCE: Clear cache when zoom changes
      this._clearTransformCache();
      this._viewportDirty = true;
      this._lastScale = this.scale;
      this._lastOffsetX = this.offsetX;
      this._lastOffsetY = this.offsetY;
      
      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-zoom',
        mousePosition: { x: mouseX, y: mouseY },
        delta,
        currentScale: this.scale
      });
      return false;
    }
  }

  screenToCanvas(screenX, screenY) {
    try {
      if (typeof screenX !== 'number' || typeof screenY !== 'number') {
        throw new Error('Invalid screen coordinates');
      }

      if (!isFinite(screenX) || !isFinite(screenY)) {
        throw new Error('Non-finite screen coordinates');
      }

      if (this.scale === 0) {
        throw new Error('Invalid scale value (zero) for coordinate conversion');
      }

      // PERFORMANCE: Use cached result during panning if available
      // Cache is valid within the same frame (same offset/scale)
      // Cache key includes viewport state to ensure correctness
      if (this._isPanning && !this._viewportDirty) {
        const cacheKey = `screenToCanvas_${screenX}_${screenY}`;
        const cached = this._transformCache.get(cacheKey);
        if (cached) {
          return cached;
        }
      }

      const canvasX = (screenX - this.offsetX) / this.scale;
      const canvasY = (screenY - this.offsetY) / this.scale;

      if (!isFinite(canvasX) || !isFinite(canvasY)) {
        throw new Error('Invalid canvas coordinate calculation');
      }

      const result = {
        x: canvasX,
        y: canvasY,
      };
      
      // PERFORMANCE: Cache result during panning
      // Only cache if viewport is not dirty (same frame)
      if (this._isPanning && !this._viewportDirty) {
        const cacheKey = `screenToCanvas_${screenX}_${screenY}`;
        this._setCachedTransform(cacheKey, result);
      }

      return result;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-screen-to-canvas',
        screenCoordinates: { x: screenX, y: screenY },
        viewportState: {
          offsetX: this.offsetX,
          offsetY: this.offsetY,
          scale: this.scale
        }
      });
      // Return safe fallback
      return { x: 0, y: 0 };
    }
  }

  canvasToScreen(canvasX, canvasY) {
    try {
      if (typeof canvasX !== 'number' || typeof canvasY !== 'number') {
        throw new Error('Invalid canvas coordinates');
      }

      if (!isFinite(canvasX) || !isFinite(canvasY)) {
        throw new Error('Non-finite canvas coordinates');
      }

      // PERFORMANCE: Use cached result during panning if available
      // Cache is valid within the same frame (same offset/scale)
      if (this._isPanning && !this._viewportDirty) {
        const cacheKey = `canvasToScreen_${canvasX}_${canvasY}`;
        const cached = this._transformCache.get(cacheKey);
        if (cached) {
          return cached;
        }
      }

      const screenX = canvasX * this.scale + this.offsetX;
      const screenY = canvasY * this.scale + this.offsetY;

      if (!isFinite(screenX) || !isFinite(screenY)) {
        throw new Error('Invalid screen coordinate calculation');
      }

      const result = {
        x: screenX,
        y: screenY,
      };
      
      // PERFORMANCE: Cache result during panning
      // Only cache if viewport is not dirty (same frame)
      if (this._isPanning && !this._viewportDirty) {
        const cacheKey = `canvasToScreen_${canvasX}_${canvasY}`;
        this._setCachedTransform(cacheKey, result);
      }

      return result;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-canvas-to-screen',
        canvasCoordinates: { x: canvasX, y: canvasY },
        viewportState: {
          offsetX: this.offsetX,
          offsetY: this.offsetY,
          scale: this.scale
        }
      });
      // Return safe fallback
      return { x: 0, y: 0 };
    }
  }

  isPanning() {
    try {
      return this._isPanning;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-is-panning-check'
      });
      return false;
    }
  }

  // Additional utility methods with error handling

  resetViewport() {
    try {
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.stopPan();

    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-reset'
      });
    }
  }

  setViewport(scale, offsetX, offsetY) {
    try {
      if (typeof scale !== 'number' || typeof offsetX !== 'number' || typeof offsetY !== 'number') {
        throw new Error('Invalid viewport parameters');
      }

      if (!isFinite(scale) || !isFinite(offsetX) || !isFinite(offsetY)) {
        throw new Error('Non-finite viewport parameters');
      }

      if (scale <= 0) {
        throw new Error('Scale must be positive');
      }

      this.scale = Math.min(2.5, Math.max(0.25, scale));
      this.offsetX = offsetX;
      this.offsetY = offsetY;
      
      // PERFORMANCE: Clear cache when viewport is manually set
      if (this.scale !== this._lastScale || 
          this.offsetX !== this._lastOffsetX || 
          this.offsetY !== this._lastOffsetY) {
        this._clearTransformCache();
        this._viewportDirty = true;
        this._lastScale = this.scale;
        this._lastOffsetX = this.offsetX;
        this._lastOffsetY = this.offsetY;
      }
      
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-set',
        parameters: { scale, offsetX, offsetY }
      });
    }
  }

  getViewportState() {
    try {
      return {
        scale: this.scale,
        offsetX: this.offsetX,
        offsetY: this.offsetY,
        isPanning: this._isPanning,
        hasPanStart: !!this._panStart
      };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-get-state'
      });
      return {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        isPanning: false,
        hasPanStart: false,
        error: error.message
      };
    }
  }

  fitToContent(contentBounds, padding = 50) {
    try {
      if (!contentBounds || typeof contentBounds !== 'object') {
        throw new Error('Invalid content bounds');
      }

      const { minX, minY, maxX, maxY } = contentBounds;

      if (typeof minX !== 'number' || typeof minY !== 'number' || 
          typeof maxX !== 'number' || typeof maxY !== 'number') {
        throw new Error('Content bounds must contain numeric values');
      }

      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
        throw new Error('Content bounds contain non-finite values');
      }

      if (maxX <= minX || maxY <= minY) {
        throw new Error('Invalid content bounds: max must be greater than min');
      }

      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;

      if (contentWidth <= 0 || contentHeight <= 0) {
        throw new Error('Content has no size');
      }

      // The visible canvas, not the whole window: a docked panel holds part of
      // the width, and fitting to the window would centre the graph half under
      // it. See src/ui/dockLayout.js.
      const viewportWidth = canvasViewportWidth() || 800;
      const viewportHeight = window.innerHeight || 600;

      const scaleX = (viewportWidth - padding * 2) / contentWidth;
      const scaleY = (viewportHeight - padding * 2) / contentHeight;
      const newScale = Math.min(scaleX, scaleY, 2.5); // Respect max zoom

      if (newScale <= 0 || !isFinite(newScale)) {
        throw new Error('Invalid scale calculation');
      }

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const newOffsetX = viewportWidth / 2 - centerX * newScale;
      const newOffsetY = viewportHeight / 2 - centerY * newScale;

      if (!isFinite(newOffsetX) || !isFinite(newOffsetY)) {
        throw new Error('Invalid offset calculation');
      }

      this.scale = Math.max(0.25, newScale); // Respect min zoom
      this.offsetX = newOffsetX;
      this.offsetY = newOffsetY;
      
      // PERFORMANCE: Clear cache when viewport changes
      this._clearTransformCache();
      this._viewportDirty = true;
      this._lastScale = this.scale;
      this._lastOffsetX = this.offsetX;
      this._lastOffsetY = this.offsetY;

      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-fit-to-content',
        contentBounds,
        padding
      });
      return false;
    }
  }

  validateState() {
    try {
      const issues = [];

      if (typeof this.scale !== 'number' || !isFinite(this.scale)) {
        issues.push('Invalid scale value');
      } else if (this.scale <= 0) {
        issues.push('Scale must be positive');
      }

      if (typeof this.offsetX !== 'number' || !isFinite(this.offsetX)) {
        issues.push('Invalid offsetX value');
      }

      if (typeof this.offsetY !== 'number' || !isFinite(this.offsetY)) {
        issues.push('Invalid offsetY value');
      }

      if (typeof this._isPanning !== 'boolean') {
        issues.push('Invalid isPanning state');
      }

      if (this._isPanning && !this._panStart) {
        issues.push('Panning state inconsistent: isPanning true but no panStart');
      }

      if (this._panStart) {
        if (typeof this._panStart.x !== 'number' || !isFinite(this._panStart.x)) {
          issues.push('Invalid panStart.x value');
        }
        if (typeof this._panStart.y !== 'number' || !isFinite(this._panStart.y)) {
          issues.push('Invalid panStart.y value');
        }
      }

      if (issues.length > 0) {

        return { valid: false, issues };
      }

      return { valid: true, issues: [] };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-validate-state'
      });
      return { valid: false, issues: ['Validation failed'], error: error.message };
    }
  }
  
  // PERFORMANCE: Helper methods for transform caching
  
  /**
   * Set a cached transform result with size limit
   */
  _setCachedTransform(key, value) {
    // Limit cache size to prevent memory issues
    if (this._transformCache.size >= this._cacheMaxSize) {
      // Remove oldest entries (first 10% of cache)
      const entriesToRemove = Math.floor(this._cacheMaxSize * 0.1);
      const keysToRemove = Array.from(this._transformCache.keys()).slice(0, entriesToRemove);
      keysToRemove.forEach(k => this._transformCache.delete(k));
    }
    this._transformCache.set(key, value);
  }
  
  /**
   * Clear all cached transform results
   */
  _clearTransformCache() {
    this._transformCache.clear();
  }
  
  /**
   * Check if viewport transform is dirty (needs recalculation)
   */
  isViewportDirty() {
    return this._viewportDirty || 
           this.scale !== this._lastScale ||
           this.offsetX !== this._lastOffsetX ||
           this.offsetY !== this._lastOffsetY;
  }
  
  /**
   * Mark viewport as clean (after recalculation)
   */
  markViewportClean() {
    this._viewportDirty = false;
    this._lastScale = this.scale;
    this._lastOffsetX = this.offsetX;
    this._lastOffsetY = this.offsetY;
  }
  
  /**
   * Get pan velocity for fast pan detection
   */
  getPanVelocity() {
    return { ...this._panVelocity };
  }
  
  /**
   * Check if panning is fast (for skipping expensive operations)
   */
  isFastPanning(threshold = 5) {
    if (!this._isPanning) return false;
    const speed = Math.sqrt(this._panVelocity.x * this._panVelocity.x + 
                           this._panVelocity.y * this._panVelocity.y);
    return speed > threshold;
  }
}