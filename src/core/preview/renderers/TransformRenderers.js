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
      'flip2d': (ctx, node) => this.renderFlip2D(ctx, node),
      'spherize': (ctx, node) => this.renderSpherize(ctx, node),
      'twirl': (ctx, node) => this.renderTwirl(ctx, node),

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

  // Get the preview of the input node (if connected)
  getInputPreview(node) {
    try {
      // Check if node has an input connection (usually input[0] for transforms)
      if (!node.inputs || !node.inputs[0]) {
        console.log(`Transform node ${node.id} has no input connection`);
        return null;
      }

      const inputNodeId = node.inputs[0];
      const graph = this.previewSystem?.editor?.graph;

      if (!graph) {
        console.warn('No graph available in preview system');
        return null;
      }

      // Find the input node
      const inputNode = graph.nodes.find(n => n.id === inputNodeId);

      if (!inputNode) {
        console.warn(`Input node ${inputNodeId} not found in graph`);
        return null;
      }

      console.log(`Transform ${node.id} checking input ${inputNode.kind} (${inputNode.id})`);

      // Return the input node's preview (topological sort ensures it's already rendered)
      // If it's not available, return null and let validation handle it
      if (inputNode.__thumb) {
        console.log(`✓ Got input preview from ${inputNode.kind}, size: ${inputNode.__thumb.width}x${inputNode.__thumb.height}`);
      } else {
        console.log(`✗ Input node ${inputNode.kind} has no __thumb yet (will retry on next render)`);
      }

      return inputNode.__thumb || null;
    } catch (error) {
      console.warn('Error getting input preview:', error);
      return null;
    }
  }

  // Apply transformation to an input image
  applyImageTransform(ctx, inputCanvas, params) {
    try {
      const { translateX, translateY, scaleX, scaleY, rotation, centerX, centerY } = params;

      // Clear background
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, this.size, this.size);

      // Validate input canvas has valid dimensions
      if (!inputCanvas || !inputCanvas.width || !inputCanvas.height) {
        console.warn('Invalid input canvas for transform, dimensions:', inputCanvas?.width, 'x', inputCanvas?.height);
        return;
      }

      // Save context state
      ctx.save();

      // For transform preview, we need to think about UV space transformation
      // The shader does: transformed_uv = (scale * rotate * (uv - center)) + center + translate
      
      // Start by moving origin to center of canvas
      ctx.translate(this.size / 2, this.size / 2);
      
      // Apply the translation (in pixels)
      ctx.translate(-translateX * this.size, -translateY * this.size);
      
      // Move to the pivot point (relative to center)
      const pivotOffsetX = (centerX - 0.5) * this.size;
      const pivotOffsetY = (centerY - 0.5) * this.size;
      ctx.translate(pivotOffsetX, pivotOffsetY);
      
      // Apply rotation
      ctx.rotate(-rotation);  // Negative because canvas Y is inverted
      
      // Apply scale
      ctx.scale(scaleX, scaleY);
      
      // Move back from pivot
      ctx.translate(-pivotOffsetX, -pivotOffsetY);

      // Draw the image centered
      ctx.drawImage(
        inputCanvas,
        -this.size / 2,
        -this.size / 2,
        this.size,
        this.size
      );

      // Restore context state
      ctx.restore();
    } catch (error) {
      console.warn('Error applying image transform:', error);
      // Fallback: just draw the input
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, this.size, this.size);
      if (inputCanvas && inputCanvas.width && inputCanvas.height) {
        ctx.drawImage(inputCanvas, 0, 0, this.size, this.size);
      }
    }
  }

  // Apply tiling transformation (repeating pattern)
  // OPTIMIZED: Use createPattern() instead of nested loop for better performance
  applyTilingTransform(ctx, inputCanvas, params) {
    try {
      const { tilingX, tilingY, offsetX, offsetY } = params;

      // Clear background
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, this.size, this.size);

      // Validate input canvas has valid dimensions
      if (!inputCanvas || !inputCanvas.width || !inputCanvas.height) {
        console.warn('Invalid input canvas for tiling, dimensions:', inputCanvas?.width, 'x', inputCanvas?.height);
        return;
      }

      ctx.save();

      // OPTIMIZATION: Use createPattern for hardware-accelerated tiling
      // This is MUCH faster than drawing multiple tiles in a loop, especially for small tiling values
      const pattern = ctx.createPattern(inputCanvas, 'repeat');

      if (pattern) {
        // Apply tiling and offset transformations
        // The pattern needs to be scaled and translated
        ctx.translate(offsetX * this.size, offsetY * this.size);
        ctx.scale(tilingX, tilingY);

        // Fill the entire canvas with the pattern
        // We need to account for the transformations when calculating the fill area
        const fillWidth = this.size / tilingX;
        const fillHeight = this.size / tilingY;
        const fillX = -offsetX * this.size / tilingX;
        const fillY = -offsetY * this.size / tilingY;

        ctx.fillStyle = pattern;
        ctx.fillRect(fillX, fillY, fillWidth, fillHeight);
      } else {
        // Fallback if pattern creation fails
        console.warn('Failed to create pattern, using fallback');
        ctx.drawImage(inputCanvas, 0, 0, this.size, this.size);
      }

      ctx.restore();
    } catch (error) {
      console.warn('Error applying tiling transform:', error);
      // Fallback: just draw the input once
      if (inputCanvas && inputCanvas.width && inputCanvas.height) {
        ctx.drawImage(inputCanvas, 0, 0, this.size, this.size);
      }
    }
  }

  // Apply non-linear UV transform by sampling the source canvas
  applyUVTransform(ctx, inputCanvas, transformFunc) {
    try {
      const width = this.size;
      const height = this.size;

      // Validate input canvas exists and has valid dimensions
      if (!inputCanvas || !inputCanvas.width || !inputCanvas.height) {
        console.warn('Invalid input canvas for UV transform, dimensions:', inputCanvas?.width, 'x', inputCanvas?.height);
        ctx.fillStyle = "#141414";
        ctx.fillRect(0, 0, width, height);
        return;
      }

      const sourceCtx = inputCanvas.getContext('2d');
      if (!sourceCtx) {
        throw new Error('Input preview has no 2D context');
      }

      const sourceWidth = inputCanvas.width;
      const sourceHeight = inputCanvas.height;

      if (!sourceWidth || !sourceHeight) {
        throw new Error('Input preview has invalid dimensions');
      }

      const sourceData = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight);
      const destData = ctx.createImageData(width, height);

      const srcPixels = sourceData.data;
      const dstPixels = destData.data;

      const clamp01 = value => Math.max(0, Math.min(1, value));

      // Clear destination background before drawing
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, width, height);

      for (let y = 0; y < height; y++) {
        const v = height > 1 ? y / (height - 1) : 0;
        for (let x = 0; x < width; x++) {
          const u = width > 1 ? x / (width - 1) : 0;
          const mapped = transformFunc(u, v);

          const sampleU = clamp01(mapped.u);
          const sampleV = clamp01(mapped.v);

          const sampleX = Math.round(sampleU * (sourceWidth - 1));
          const sampleY = Math.round(sampleV * (sourceHeight - 1));

          const srcIndex = (sampleY * sourceWidth + sampleX) * 4;
          const dstIndex = (y * width + x) * 4;

          dstPixels[dstIndex] = srcPixels[srcIndex];
          dstPixels[dstIndex + 1] = srcPixels[srcIndex + 1];
          dstPixels[dstIndex + 2] = srcPixels[srcIndex + 2];
          dstPixels[dstIndex + 3] = srcPixels[srcIndex + 3];
        }
      }

      ctx.putImageData(destData, 0, 0);
    } catch (error) {
      console.warn('Error applying UV transform:', error);
      if (inputCanvas && inputCanvas.width && inputCanvas.height) {
        ctx.drawImage(inputCanvas, 0, 0, this.size, this.size);
      }
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

  drawEffectBadge(ctx, label) {
    if (!label) return;
    ctx.save();
    ctx.fillStyle = "rgba(74, 144, 226, 0.85)";
    ctx.fillRect(0, 0, 16, 12);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 7px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 8, 6);
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
      if (index < 3 && key && value !== undefined) {
        let displayValue;
        if (typeof value === 'number') {
          displayValue = Math.abs(value) < 0.01 ? value.toExponential(1) : value.toFixed(2);
        } else {
          displayValue = String(value);
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
    const translateX = this.toSafeNumber(this.getParameterValue(node, "translateX", 0.0), 0.0);
    const translateY = this.toSafeNumber(this.getParameterValue(node, "translateY", 0.0), 0.0);
    const scaleX = this.toSafeNumber(this.getParameterValue(node, "scaleX", 1.0), 1.0);
    const scaleY = this.toSafeNumber(this.getParameterValue(node, "scaleY", 1.0), 1.0);
    const rotation = this.toSafeNumber(this.getParameterValue(node, "rotation", 0.0), 0.0);
    const centerX = this.toSafeNumber(this.getParameterValue(node, "centerX", 0.5), 0.5);
    const centerY = this.toSafeNumber(this.getParameterValue(node, "centerY", 0.5), 0.5);

    // Check if there's an input to transform
    const inputCanvas = this.getInputPreview(node);
    
    if (inputCanvas) {
      console.log(`✓ Transform2D rendering with input from Circle`);
      console.log(`   Canvas context: ${ctx.canvas.width}x${ctx.canvas.height}`);
      
      // Transform the input image
      this.applyImageTransform(ctx, inputCanvas, {
        translateX, translateY, scaleX, scaleY, rotation, centerX, centerY
      });
      
      // Log after drawing
      console.log(`   Finished drawing to canvas, node.__thumb will be:`, ctx.canvas);
      
      // Add visual indicator that this is showing transformed input
      ctx.save();
      ctx.fillStyle = "rgba(74, 144, 226, 0.8)";
      ctx.fillRect(0, 0, 12, 10);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 7px Arial";
      ctx.textAlign = "center";
      ctx.fillText("T", 6, 7);
      ctx.restore();
      
      if (this.hasExpressions(node)) {
        this.drawExpressionIndicator(ctx);
      }
      return;
    }

    // No input - show UV grid
    console.log(`Transform2D has no input, showing UV grid`);
    const cos_r = Math.cos(rotation);
    const sin_r = Math.sin(rotation);

    const transformFunc = (u, v) => {
      u -= centerX;
      v -= centerY;
      const rotU = u * cos_r - v * sin_r;
      const rotV = u * sin_r + v * cos_r;
      const scaleU = rotU * scaleX;
      const scaleV = rotV * scaleY;
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

    // Check for input
    const inputCanvas = this.getInputPreview(node);
    
    if (inputCanvas) {
      this.applyImageTransform(ctx, inputCanvas, {
        translateX: 0, translateY: 0,
        scaleX, scaleY,
        rotation: 0,
        centerX, centerY
      });
      
      if (this.hasExpressions(node)) {
        this.drawExpressionIndicator(ctx);
      }
      return;
    }

    // No input - show UV grid
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

    // Check for input
    const inputCanvas = this.getInputPreview(node);
    
    if (inputCanvas) {
      this.applyImageTransform(ctx, inputCanvas, {
        translateX: 0, translateY: 0,
        scaleX: 1, scaleY: 1,
        rotation,
        centerX, centerY
      });
      
      if (this.hasExpressions(node)) {
        this.drawExpressionIndicator(ctx);
      }
      return;
    }

    // No input - show UV grid
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

    // Check for input
    const inputCanvas = this.getInputPreview(node);
    
    if (inputCanvas) {
      this.applyImageTransform(ctx, inputCanvas, {
        translateX, translateY,
        scaleX: 1, scaleY: 1,
        rotation: 0,
        centerX: 0.5, centerY: 0.5
      });
      
      if (this.hasExpressions(node)) {
        this.drawExpressionIndicator(ctx);
      }
      return;
    }

    // No input - show UV grid
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

    // Check for input
    const inputCanvas = this.getInputPreview(node);
    
    if (inputCanvas) {
      // For tiling, we need a different approach
      this.applyTilingTransform(ctx, inputCanvas, {
        tilingX, tilingY, offsetX, offsetY
      });
      
      if (this.hasExpressions(node)) {
        this.drawExpressionIndicator(ctx);
      }
      return;
    }

    // No input - show UV grid
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

    // Check for input
    const inputCanvas = this.getInputPreview(node);
    
    if (inputCanvas) {
      const scaleX = flipX ? -1.0 : 1.0;
      const scaleY = flipY ? -1.0 : 1.0;
      const centerX = flipX ? 1.0 : 0.0;
      const centerY = flipY ? 1.0 : 0.0;
      
      this.applyImageTransform(ctx, inputCanvas, {
        translateX: centerX, translateY: centerY,
        scaleX, scaleY,
        rotation: 0,
        centerX: 0.5, centerY: 0.5
      });
      
      if (this.hasExpressions(node)) {
        this.drawExpressionIndicator(ctx);
      }
      return;
    }

    // No input - show UV grid
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
  renderTwirl(ctx, node) {
    const centerX = this.toSafeNumber(this.getParameterValue(node, "centerX", 0.5), 0.5);
    const centerY = this.toSafeNumber(this.getParameterValue(node, "centerY", 0.5), 0.5);
    const strength = this.toSafeNumber(this.getParameterValue(node, "strength", 1.0), 1.0);
    const radius = Math.max(0, this.toSafeNumber(this.getParameterValue(node, "radius", 0.5), 0.5));

    const clamp01 = value => Math.max(0, Math.min(1, value));
    const smoothstep = (edge0, edge1, x) => {
      const denom = edge1 - edge0;
      if (denom === 0) {
        return x < edge0 ? 0 : 1;
      }
      const t = clamp01((x - edge0) / denom);
      return t * t * (3 - 2 * t);
    };

    const transformFunc = (u, v) => {
      const dx = u - centerX;
      const dy = v - centerY;
      const dist = Math.hypot(dx, dy);

      if (radius > 0 && dist > 0) {
        const angle = Math.atan2(dy, dx);
        const twist = smoothstep(radius, 0, dist) * strength;
        const sinA = Math.sin(angle + twist);
        const cosA = Math.cos(angle + twist);
        const nx = cosA * dist;
        const ny = sinA * dist;
        return {
          u: clamp01(centerX + nx),
          v: clamp01(centerY + ny)
        };
      }

      return {
        u: clamp01(u),
        v: clamp01(v)
      };
    };

    const inputCanvas = this.getInputPreview(node);
    if (inputCanvas) {
      this.applyUVTransform(ctx, inputCanvas, transformFunc);
      this.drawEffectBadge(ctx, "TW");

      if (this.hasExpressions(node)) {
        this.drawExpressionIndicator(ctx);
      }
      return;
    }

    this.renderUVGrid(ctx, transformFunc, "TWIRL", {
      str: strength,
      rad: radius
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderSpherize(ctx, node) {
    const centerX = this.toSafeNumber(this.getParameterValue(node, "centerX", 0.5), 0.5);
    const centerY = this.toSafeNumber(this.getParameterValue(node, "centerY", 0.5), 0.5);
    const strength = this.toSafeNumber(this.getParameterValue(node, "strength", 0.5), 0.5);
    const radius = Math.max(0, this.toSafeNumber(this.getParameterValue(node, "radius", 0.5), 0.5));

    const clamp01 = value => Math.max(0, Math.min(1, value));

    const transformFunc = (u, v) => {
      const dx = u - centerX;
      const dy = v - centerY;
      const dist = Math.hypot(dx, dy);

      if (radius > 0 && dist > 0) {
        const factor = clamp01(dist / radius);
        const scale = 1 - strength * factor * factor;
        return {
          u: clamp01(centerX + dx * scale),
          v: clamp01(centerY + dy * scale)
        };
      }

      return {
        u: clamp01(u),
        v: clamp01(v)
      };
    };

    const inputCanvas = this.getInputPreview(node);
    if (inputCanvas) {
      this.applyUVTransform(ctx, inputCanvas, transformFunc);
      this.drawEffectBadge(ctx, "SP");

      if (this.hasExpressions(node)) {
        this.drawExpressionIndicator(ctx);
      }
      return;
    }

    this.renderUVGrid(ctx, transformFunc, "SPHERE", {
      str: strength,
      rad: radius
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }
}
