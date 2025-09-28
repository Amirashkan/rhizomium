// src/core/preview/renderers/TransformRenderers.js

export class TransformRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      'transform2d': (ctx, node) => this.renderTransform2D(ctx, node),
      'scale2d': (ctx, node) => this.renderScale2D(ctx, node),
      'rotate2d': (ctx, node) => this.renderRotate2D(ctx, node),
      'translate2d': (ctx, node) => this.renderTranslate2D(ctx, node),
      'tileandoffset': (ctx, node) => this.renderTileAndOffset(ctx, node),
      'flip2d': (ctx, node) => this.renderFlip2D(ctx, node)
    });
  }

  // Helper method to get parameter values with expression support
  getParameterValue(node, paramName, defaultValue = 0) {
    try {
      // Use the preview system's parameter method if available
      if (this.previewSystem && this.previewSystem.getParameterValue) {
        return this.previewSystem.getParameterValue(node, paramName, defaultValue);
      }
      
      const rawValue = node.params?.[paramName] ?? defaultValue;
      
      // Check if it's an expression
      if (typeof rawValue === 'string' && rawValue.startsWith('=')) {
        return window.editor.paramPanel.expressionSystem.evaluateExpression(rawValue, {}, node);
      }
      
      // Handle boolean values
      if (typeof rawValue === 'boolean') return rawValue;
      
      // Return parsed value or default
      return typeof rawValue === 'number' ? rawValue : (parseFloat(rawValue) || defaultValue);
    } catch (error) {
      console.warn(`Error getting parameter ${paramName}:`, error);
      return defaultValue;
    }
  }

  // Helper to safely convert values to numbers
  toSafeNumber(value, defaultValue = 0) {
    if (value == null) return defaultValue;
    
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
      return value;
    }
    
    const parsed = Number(value);
    return !isNaN(parsed) && isFinite(parsed) ? parsed : defaultValue;
  }

  // Helper to check if any parameter is an expression
  hasExpressions(node) {
    try {
      if (!node.params) return false;
      return Object.values(node.params).some(value => 
        typeof value === 'string' && value.trim().startsWith('=')
      );
    } catch (error) {
      return false;
    }
  }

  // Draw expression indicator
  drawExpressionIndicator(ctx) {
    ctx.save();
    ctx.fillStyle = "#4CAF50";
    ctx.fillRect(this.size - 12, 2, 10, 8);
    ctx.fillStyle = "#ffffff";
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("fx", this.size - 7, 6);
    ctx.restore();
  }

  // Draw parameter info overlay
  drawParameterInfo(ctx, params) {
    ctx.save();
    ctx.fillStyle = "#00000080";
    ctx.fillRect(0, this.size - 20, this.size, 20);
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    
    let y = this.size - 14;
    Object.entries(params).forEach(([key, value], index) => {
      if (index < 3 && key && value !== undefined) { // Check for undefined
        let displayValue;
        if (typeof value === 'number') {
          displayValue = Math.abs(value) < 0.01 ? value.toExponential(1) : value.toFixed(2);
        } else {
          displayValue = String(value); // Safe conversion
        }
        ctx.fillText(`${key}:${displayValue}`, 2, y + index * 6);
      }
    });
    
    ctx.restore();
  }

  // Base method to render UV grid visualization
  renderUVGrid(ctx, transformFunc, label, params = {}) {
    // Clear background
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, this.size, this.size);

    // Draw transformed grid
    ctx.strokeStyle = "#4a90e2";
    ctx.lineWidth = 1;

    const gridRes = 8;
    for (let i = 0; i <= gridRes; i++) {
      // Vertical lines
      ctx.beginPath();
      for (let j = 0; j <= gridRes; j++) {
        const u = i / gridRes;
        const v = j / gridRes;
        const transformed = transformFunc(u, v);
        const x = transformed.u * this.size;
        const y = transformed.v * this.size;
        
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Horizontal lines
      ctx.beginPath();
      for (let j = 0; j <= gridRes; j++) {
        const u = j / gridRes;
        const v = i / gridRes;
        const transformed = transformFunc(u, v);
        const x = transformed.u * this.size;
        const y = transformed.v * this.size;
        
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Draw origin marker
    const origin = transformFunc(0, 0);
    ctx.fillStyle = "#ff4444";
    ctx.fillRect(origin.u * this.size - 2, origin.v * this.size - 2, 4, 4);

    // Draw center marker (0.5, 0.5)
    const center = transformFunc(0.5, 0.5);
    ctx.fillStyle = "#44ff44";
    ctx.fillRect(center.u * this.size - 2, center.v * this.size - 2, 4, 4);

    // Label
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 8px Arial";
    ctx.textAlign = "center";
    ctx.fillText(label, this.size / 2, this.size - 6);

    // Show parameters if provided
    if (Object.keys(params).length > 0) {
      this.drawParameterInfo(ctx, params);
    }
  }

  renderTransform2D(ctx, node) {
    console.log('Transform2D render called for node:', node.id, 'params:', node.params);
    
    const translateX = this.toSafeNumber(this.getParameterValue(node, "translateX", 0.0), 0.0);
    const translateY = this.toSafeNumber(this.getParameterValue(node, "translateY", 0.0), 0.0);
    const scaleX = this.toSafeNumber(this.getParameterValue(node, "scaleX", 1.0), 1.0);
    const scaleY = this.toSafeNumber(this.getParameterValue(node, "scaleY", 1.0), 1.0);
    const rotation = this.toSafeNumber(this.getParameterValue(node, "rotation", 0.0), 0.0);
    const centerX = this.toSafeNumber(this.getParameterValue(node, "centerX", 0.5), 0.5);
    const centerY = this.toSafeNumber(this.getParameterValue(node, "centerY", 0.5), 0.5);

    console.log('Transform2D evaluated params:', {
      translateX, translateY, scaleX, scaleY, rotation, centerX, centerY
    });

    const cos_r = Math.cos(rotation);
    const sin_r = Math.sin(rotation);

    const transformFunc = (u, v) => {
      // Center
      u -= centerX;
      v -= centerY;
      
      // Rotate
      const rotU = u * cos_r - v * sin_r;
      const rotV = u * sin_r + v * cos_r;
      
      // Scale
      const scaleU = rotU * scaleX;
      const scaleV = rotV * scaleY;
      
      // Uncenter and translate
      return {
        u: scaleU + centerX + translateX,
        v: scaleV + centerY + translateY
      };
    };

    this.renderUVGrid(ctx, transformFunc, "TRANS", {
      tx: translateX,
      ty: translateY,
      sx: scaleX,
      sy: scaleY,
      rot: rotation
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderScale2D(ctx, node) {
    const scaleX = this.toSafeNumber(this.getParameterValue(node, "scaleX", 1.0), 1.0);
    const scaleY = this.toSafeNumber(this.getParameterValue(node, "scaleY", 1.0), 1.0);
    const centerX = this.toSafeNumber(this.getParameterValue(node, "centerX", 0.5), 0.5);
    const centerY = this.toSafeNumber(this.getParameterValue(node, "centerY", 0.5), 0.5);

    const transformFunc = (u, v) => {
      u -= centerX;
      v -= centerY;
      u *= scaleX;
      v *= scaleY;
      return {
        u: u + centerX,
        v: v + centerY
      };
    };

    this.renderUVGrid(ctx, transformFunc, "SCALE", {
      sx: scaleX,
      sy: scaleY,
      cx: centerX !== 0.5 ? centerX : undefined
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderRotate2D(ctx, node) {
    const rotation = this.toSafeNumber(this.getParameterValue(node, "rotation", 0.0), 0.0);
    const centerX = this.toSafeNumber(this.getParameterValue(node, "centerX", 0.5), 0.5);
    const centerY = this.toSafeNumber(this.getParameterValue(node, "centerY", 0.5), 0.5);

    const cos_r = Math.cos(rotation);
    const sin_r = Math.sin(rotation);

    const transformFunc = (u, v) => {
      u -= centerX;
      v -= centerY;
      return {
        u: u * cos_r - v * sin_r + centerX,
        v: u * sin_r + v * cos_r + centerY
      };
    };

    this.renderUVGrid(ctx, transformFunc, "ROTATE", {
      rot: rotation,
      cx: centerX !== 0.5 ? centerX : undefined
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderTranslate2D(ctx, node) {
    const translateX = this.toSafeNumber(this.getParameterValue(node, "translateX", 0.0), 0.0);
    const translateY = this.toSafeNumber(this.getParameterValue(node, "translateY", 0.0), 0.0);

    const transformFunc = (u, v) => ({
      u: u + translateX,
      v: v + translateY
    });

    this.renderUVGrid(ctx, transformFunc, "MOVE", {
      tx: translateX,
      ty: translateY
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderTileAndOffset(ctx, node) {
    const tilingX = this.toSafeNumber(this.getParameterValue(node, "tilingX", 1.0), 1.0);
    const tilingY = this.toSafeNumber(this.getParameterValue(node, "tilingY", 1.0), 1.0);
    const offsetX = this.toSafeNumber(this.getParameterValue(node, "offsetX", 0.0), 0.0);
    const offsetY = this.toSafeNumber(this.getParameterValue(node, "offsetY", 0.0), 0.0);

    const transformFunc = (u, v) => ({
      u: u * tilingX + offsetX,
      v: v * tilingY + offsetY
    });

    this.renderUVGrid(ctx, transformFunc, "TILE", {
      tilX: tilingX,
      tilY: tilingY,
      ofX: offsetX,
      ofY: offsetY
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderFlip2D(ctx, node) {
    const flipX = this.getParameterValue(node, "flipX", false);
    const flipY = this.getParameterValue(node, "flipY", false);

    const scaleX = flipX ? -1.0 : 1.0;
    const scaleY = flipY ? -1.0 : 1.0;
    const offsetX = flipX ? 1.0 : 0.0;
    const offsetY = flipY ? 1.0 : 0.0;

    const transformFunc = (u, v) => ({
      u: u * scaleX + offsetX,
      v: v * scaleY + offsetY
    });

    this.renderUVGrid(ctx, transformFunc, "FLIP", {
      flipX: flipX ? "Y" : "N",
      flipY: flipY ? "Y" : "N"
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }
}