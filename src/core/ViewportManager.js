// src/core/ViewportManager.js - Enhanced with ErrorHandler integration
export class ViewportManager {
  constructor() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this._isPanning = false;
    this._panStart = null;
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
      this.offsetX = this._panStart.ox + dx;
      this.offsetY = this._panStart.oy + dy;
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

      const canvasX = (screenX - this.offsetX) / this.scale;
      const canvasY = (screenY - this.offsetY) / this.scale;

      if (!isFinite(canvasX) || !isFinite(canvasY)) {
        throw new Error('Invalid canvas coordinate calculation');
      }

      return {
        x: canvasX,
        y: canvasY,
      };
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

      const screenX = canvasX * this.scale + this.offsetX;
      const screenY = canvasY * this.scale + this.offsetY;

      if (!isFinite(screenX) || !isFinite(screenY)) {
        throw new Error('Invalid screen coordinate calculation');
      }

      return {
        x: screenX,
        y: screenY,
      };
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

      // Assume viewport size (could be passed as parameter)
      const viewportWidth = window.innerWidth || 800;
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
}