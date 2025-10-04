// src/core/preview/renderers/TextureRenderers.js - Fixed with expression evaluation

export class TextureRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    // Helper function for smoothstep
    const smoothstep = (edge0, edge1, x) => {
      const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0)));
      return t * t * (3 - 2 * t);
    };

    registry.registerMultiple({
      'rectfield': (ctx, node) => this.renderRectangle(ctx, node),
      'rectangle': (ctx, node) => this.renderRectangle(ctx, node),
      'texture2d': (ctx, node) => this.renderTexture2D(ctx, node),
      'texturecube': (ctx, node) => this.renderTextureCube(ctx, node),
'circle': (ctx, node) => {
  // Use the helper method that reads from uniform manager
  const radius = this.getParameterValue(node, 'radius', 0.25);
  const epsilon = this.getParameterValue(node, 'epsilon', 0.02);
  const centerX = this.getParameterValue(node, 'centerX', 0.5);
  const centerY = this.getParameterValue(node, 'centerY', 0.5);
  
  // Get canvas size
  const size = ctx.canvas.width || 64;
  
  // Render black background
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);
  
  // Render circle field
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dist = Math.sqrt((u - centerX) * (u - centerX) + (v - centerY) * (v - centerY));
      const safeEpsilon = Math.max(epsilon, 0.0001);
      const field = 1.0 - this._smoothstep(radius - safeEpsilon, radius + safeEpsilon, dist);
      
      if (field > 0.01) {
        const intensity = Math.max(0, Math.min(1, field));
        const color = Math.floor(intensity * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
},
      'circlefield': (ctx, node) => {
        // Use the same logic as circle
        registry.renderers.get('circle')(ctx, node);
      },
      'rectangle': (ctx, node) => this.renderRectangle(ctx, node),
      'rectfield': (ctx, node) => this.renderRectangle(ctx, node),
      'gradient': (ctx, node) => this.renderGradient(ctx, node),
      'checkerboard': (ctx, node) => this.renderCheckerboard(ctx, node)
    });
  }

  // Helper method to get parameter values with expression support
getParameterValue(node, paramName, defaultValue = 0) {
  // Use the uniform manager's evaluated values
  if (window.nodeCompiler?.uniformManager) {
    const uniformMgr = window.nodeCompiler.uniformManager;
    const key = `${node.id}.${paramName}`;
    
    if (uniformMgr.uniformValues && uniformMgr.uniformValues.has(key)) {
      return uniformMgr.uniformValues.get(key);
    }
  }
  
  // Fall back to node params
  const rawValue = node.params?.[paramName] ?? defaultValue;
  return typeof rawValue === 'number' ? rawValue : (parseFloat(rawValue) || defaultValue);
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
      if (index < 3) { // Show up to 3 parameters
        const displayValue = typeof value === 'number' ? value.toFixed(2) : value;
        ctx.fillText(`${key}:${displayValue}`, 2, y + index * 6);
      }
    });
    
    ctx.restore();
  }

  renderTexture2D(ctx, node) {
    console.log("Texture2D preview for node", node.id, "size:", this.size);

    // Get texture parameters with expression support
    const scale = this.toSafeNumber(this.getParameterValue(node, "scale", 1.0), 1.0);
    const rotation = this.toSafeNumber(this.getParameterValue(node, "rotation", 0.0), 0.0);
    const offsetX = this.toSafeNumber(this.getParameterValue(node, "offsetX", 0.0), 0.0);
    const offsetY = this.toSafeNumber(this.getParameterValue(node, "offsetY", 0.0), 0.0);

    // Check if texture is loaded
    const textureInfo = window.textureManager?.getTexture(node.id);
    console.log("Texture info for node", node.id, ":", textureInfo);

    if (textureInfo && textureInfo.file) {
      // Try to create image from file
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, this.size, this.size);
        
        // Apply transformations
        ctx.save();
        ctx.translate(this.size / 2, this.size / 2);
        ctx.rotate(rotation);
        ctx.scale(scale, scale);
        ctx.translate(-this.size / 2 + offsetX, -this.size / 2 + offsetY);
        
        ctx.drawImage(img, 0, 0, this.size, this.size);
        ctx.restore();

        // Add indicator
        ctx.fillStyle = "rgba(74, 144, 226, 0.9)";
        ctx.fillRect(0, 0, 14, 10);
        ctx.fillStyle = "white";
        ctx.font = "bold 8px Arial";
        ctx.fillText("2D", 2, 8);

        // Show parameters if they're non-default
        if (scale !== 1.0 || rotation !== 0.0 || offsetX !== 0.0 || offsetY !== 0.0) {
          this.drawParameterInfo(ctx, { scale, rot: rotation, x: offsetX, y: offsetY });
        }

        if (this.hasExpressions(node)) {
          this.drawExpressionIndicator(ctx);
        }
      };
      img.onerror = () => {
        // Handle image load error
        this.renderTextureError(ctx, "Load Error");
      };
      img.src = URL.createObjectURL(textureInfo.file);

      // Show loading state
      ctx.fillStyle = "#555";
      ctx.fillRect(0, 0, this.size, this.size);
      ctx.fillStyle = "#4a90e2";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Loading...", this.size / 2, this.size / 2);
    } else {
      // No texture - show placeholder
      ctx.fillStyle = "#444";
      ctx.fillRect(0, 0, this.size, this.size);

      // Bright border
      ctx.strokeStyle = "#4a90e2";
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, this.size - 4, this.size - 4);

      // Text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.fillText("2D", this.size / 2, this.size / 2 - 4);
      ctx.fillText("TEX", this.size / 2, this.size / 2 + 10);

      if (this.hasExpressions(node)) {
        this.drawExpressionIndicator(ctx);
      }
    }

    console.log("Texture2D preview complete:", "dimensions:", this.size, "x", this.size);
  }

  renderTextureError(ctx, errorText) {
    ctx.fillStyle = "#ff4444";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 8px Arial";
    ctx.textAlign = "center";
    ctx.fillText(errorText, this.size / 2, this.size / 2);
  }

  renderTextureCube(ctx, node) {
    // Get cube texture parameters
    const faceSize = this.toSafeNumber(this.getParameterValue(node, "faceSize", 1.0), 1.0);
    const perspective = this.toSafeNumber(this.getParameterValue(node, "perspective", 0.3), 0.3);

    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, this.size, this.size);

    // Draw a cube wireframe with perspective
    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const cubeSize = this.size * 0.3 * faceSize;

    ctx.strokeStyle = "#4a90e2";
    ctx.lineWidth = 2;

    // Front face
    ctx.strokeRect(
      centerX - cubeSize,
      centerY - cubeSize,
      cubeSize * 2,
      cubeSize * 2
    );

    // Back face (offset based on perspective)
    const offset = cubeSize * perspective;
    ctx.strokeRect(
      centerX - cubeSize + offset,
      centerY - cubeSize + offset,
      cubeSize * 2,
      cubeSize * 2
    );

    // Connecting lines
    ctx.beginPath();
    ctx.moveTo(centerX - cubeSize, centerY - cubeSize);
    ctx.lineTo(centerX - cubeSize + offset, centerY - cubeSize + offset);
    ctx.moveTo(centerX + cubeSize, centerY - cubeSize);
    ctx.lineTo(centerX + cubeSize + offset, centerY - cubeSize + offset);
    ctx.moveTo(centerX - cubeSize, centerY + cubeSize);
    ctx.lineTo(centerX - cubeSize + offset, centerY + cubeSize + offset);
    ctx.moveTo(centerX + cubeSize, centerY + cubeSize);
    ctx.lineTo(centerX + cubeSize + offset, centerY + cubeSize + offset);
    ctx.stroke();

    // Label
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 8px Arial";
    ctx.textAlign = "center";
    ctx.fillText("CUBE", this.size / 2, this.size - 6);

    // Show parameters
    this.drawParameterInfo(ctx, { size: faceSize, persp: perspective });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderCircle(ctx, node) {
    // Get raw parameter values
    let radiusParam = node.params?.radius ?? 0.25;
    let epsilonParam = node.params?.epsilon ?? 0.02;
    
    // Evaluate expressions if they exist
    let radius, epsilon;
    if (typeof radiusParam === 'string' && radiusParam.startsWith('=')) {
      try {
        radius = window.editor.paramPanel.expressionSystem.evaluateExpression(radiusParam, {}, node);
      } catch (error) {
        console.warn('Expression evaluation failed:', error);
        radius = 0.25;
      }
    } else {
      radius = parseFloat(radiusParam) || 0.25;
    }
    
    if (typeof epsilonParam === 'string' && epsilonParam.startsWith('=')) {
      try {
        epsilon = window.editor.paramPanel.expressionSystem.evaluateExpression(epsilonParam, {}, node);
      } catch (error) {
        console.warn('Expression evaluation failed:', error);
        epsilon = 0.02;
      }
    } else {
      epsilon = parseFloat(epsilonParam) || 0.02;
    }

    const centerX = this.toSafeNumber(this.getParameterValue(node, "centerX", 0.5), 0.5);
    const centerY = this.toSafeNumber(this.getParameterValue(node, "centerY", 0.5), 0.5);

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, this.size, this.size);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = x / this.size;
        const v = y / this.size;
        const dist = Math.sqrt((u - centerX) * (u - centerX) + (v - centerY) * (v - centerY));
        const safeEpsilon = Math.max(epsilon, 0.0001);
        const field = 1.0 - this._smoothstep(radius - safeEpsilon, radius + safeEpsilon, dist);

        if (field > 0.01) {
          const intensity = Math.max(0, Math.min(1, field));
          const color = Math.floor(intensity * 255);
          ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    // Show parameters
    this.drawParameterInfo(ctx, { 
      rad: radius, 
      eps: epsilon, 
      cx: centerX !== 0.5 ? centerX : undefined 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

 
renderRectangle(ctx, node) {
  const width = this.getParameterValue(node, "width", 0.5);
  const height = this.getParameterValue(node, "height", 0.3);
  const centerX = this.getParameterValue(node, "centerX", 0.5);
  const centerY = this.getParameterValue(node, "centerY", 0.5);
  const epsilon = this.getParameterValue(node, "epsilon", 0.02);

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, this.size, this.size);

  // Render rectangle field
  for (let y = 0; y < this.size; y++) {
    for (let x = 0; x < this.size; x++) {
      const u = x / this.size;
      const v = y / this.size;
      
      // Distance to rectangle edges (SDF)
      const dx = Math.max(0, Math.abs(u - centerX) - width / 2);
      const dy = Math.max(0, Math.abs(v - centerY) - height / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const safeEpsilon = Math.max(epsilon, 0.0001);
      const field = 1.0 - this._smoothstep(-safeEpsilon, safeEpsilon, dist);

      if (field > 0.01) {
        const intensity = Math.max(0, Math.min(1, field));
        const color = Math.floor(intensity * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
}}

  renderGradient(ctx, node) {
    const direction = this.getParameterValue(node, "direction", "horizontal");
    const startColor = this.getParameterValue(node, "startColor", 0.0);
    const endColor = this.getParameterValue(node, "endColor", 1.0);
    const power = this.toSafeNumber(this.getParameterValue(node, "power", 1.0), 1.0);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let t;
        switch (direction) {
          case "vertical":
            t = y / this.size;
            break;
          case "diagonal":
            t = (x + y) / (this.size * 2);
            break;
          case "radial":
            const centerX = this.size / 2;
            const centerY = this.size / 2;
            const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
            const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
            t = dist / maxDist;
            break;
          default: // horizontal
            t = x / this.size;
        }

        // Apply power curve
        t = Math.pow(t, power);
        
        const value = startColor + (endColor - startColor) * t;
        const color = Math.floor(Math.max(0, Math.min(255, value * 255)));
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    this.drawParameterInfo(ctx, { 
      dir: direction.slice(0, 4), 
      start: startColor, 
      end: endColor 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderCheckerboard(ctx, node) {
    const scale = this.toSafeNumber(this.getParameterValue(node, "scale", 8.0), 8.0);
    const color1 = this.toSafeNumber(this.getParameterValue(node, "color1", 0.0), 0.0);
    const color2 = this.toSafeNumber(this.getParameterValue(node, "color2", 1.0), 1.0);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;
        
        const checkX = Math.floor(u) % 2;
        const checkY = Math.floor(v) % 2;
        const isWhite = (checkX + checkY) % 2 === 0;
        
        const value = isWhite ? color1 : color2;
        const color = Math.floor(Math.max(0, Math.min(255, value * 255)));
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    this.drawParameterInfo(ctx, { scale, c1: color1, c2: color2 });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  _smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
}