// src/core/preview/renderers/NoiseRenderers.js - Updated with expression support

export class NoiseRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      'random': (ctx, node) => this.renderRandom(ctx, node),
      'valuenoise': (ctx, node) => this.renderValueNoise(ctx, node),
      'fbmnoise': (ctx, node) => this.renderFBMNoise(ctx, node),
      'simplexnoise': (ctx, node) => this.renderSimplexNoise(ctx, node),
      'voronoinoise': (ctx, node) => this.renderVoronoiNoise(ctx, node),
      'ridgednoise': (ctx, node) => this.renderRidgedNoise(ctx, node),
      'turbulence': (ctx, node) => this.renderTurbulence(ctx, node)
    });
  }

  // Helper method to get parameter values with expression support
  getParameterValue(node, paramName, defaultValue = 0) {
    try {
      // Try the expression-aware method first
      if (this.previewSystem.getParameterValue) {
        return this.previewSystem.getParameterValue(node, paramName, defaultValue);
      }
      
      // Fallback to the old method if expression system isn't integrated yet
      if (this.previewSystem.getParameter) {
        return this.previewSystem.getParameter(node, paramName) ?? defaultValue;
      }
      
      // Direct fallback to node parameters or props
      return node.params?.[paramName] ?? node.props?.[paramName] ?? defaultValue;
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
      if (index < 3) { // Show up to 3 parameters
        const displayValue = typeof value === 'number' ? value.toFixed(2) : value;
        ctx.fillText(`${key}:${displayValue}`, 2, y + index * 6);
      }
    });
    
    ctx.restore();
  }

  renderRandom(ctx, node) {
    // Get seed parameter for consistent random patterns
    const seed = this.toSafeNumber(this.getParameterValue(node, "seed", 0), 0);
    const density = this.toSafeNumber(this.getParameterValue(node, "density", 1.0), 1.0);
    
    // Use seed for reproducible randomness
    let randomSeed = seed;
    const seededRandom = () => {
      randomSeed = (randomSeed * 9301 + 49297) % 233280;
      return randomSeed / 233280;
    };

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const noise = seededRandom() * density;
        const color = Math.floor(Math.min(255, noise * 255));
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Show parameter info
    this.drawParameterInfo(ctx, { seed, density });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderValueNoise(ctx, node) {
    const scale = this.toSafeNumber(this.getParameterValue(node, "scale", 5.0), 5.0);
    const amplitude = this.toSafeNumber(this.getParameterValue(node, "amplitude", 1.0), 1.0);
    const offset = this.toSafeNumber(this.getParameterValue(node, "offset", 0.0), 0.0);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;

        const noise = this._simpleNoise(u, v) * amplitude + offset;
        const color = Math.floor(Math.max(0, Math.min(255, (noise * 0.5 + 0.5) * 255)));
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    this.drawParameterInfo(ctx, { scale, amplitude, offset });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderFBMNoise(ctx, node) {
    const scale = this.toSafeNumber(this.getParameterValue(node, "scale", 3.0), 3.0);
    const octaves = Math.max(1, Math.min(8, Math.round(this.toSafeNumber(this.getParameterValue(node, "octaves", 4), 4))));
    const persistence = this.toSafeNumber(this.getParameterValue(node, "persistence", 0.5), 0.5);
    const lacunarity = this.toSafeNumber(this.getParameterValue(node, "lacunarity", 2.0), 2.0);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;

        let noise = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
          noise += this._simpleNoise(u * frequency, v * frequency) * amplitude;
          maxValue += amplitude;
          amplitude *= persistence;
          frequency *= lacunarity;
        }

        noise /= maxValue;
        const color = Math.floor((noise * 0.5 + 0.5) * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    this.drawParameterInfo(ctx, { scale, octaves, persist: persistence });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderSimplexNoise(ctx, node) {
    const scale = this.toSafeNumber(this.getParameterValue(node, "scale", 4.0), 4.0);
    const frequency1 = this.toSafeNumber(this.getParameterValue(node, "frequency1", 1.5), 1.5);
    const frequency2 = this.toSafeNumber(this.getParameterValue(node, "frequency2", 3.0), 3.0);
    const mix = this.toSafeNumber(this.getParameterValue(node, "mix", 0.7), 0.7);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;

        const noise1 = this._simpleNoise(u * frequency1, v * frequency1);
        const noise2 = this._simpleNoise(u * frequency2, v * frequency2);
        const noise = noise1 * mix + noise2 * (1 - mix);
        
        const color = Math.floor((noise * 0.5 + 0.5) * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    this.drawParameterInfo(ctx, { scale, freq1: frequency1, freq2: frequency2 });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderVoronoiNoise(ctx, node) {
    const scale = this.toSafeNumber(this.getParameterValue(node, "scale", 8.0), 8.0);
    const cellType = this.getParameterValue(node, "cellType", "distance");
    const randomness = this.toSafeNumber(this.getParameterValue(node, "randomness", 1.0), 1.0);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;

        const cellX = Math.floor(u);
        const cellY = Math.floor(v);

        let minDist = 999;
        let secondMinDist = 999;
        
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const pointX = cellX + dx + this._pseudoRandom(cellX + dx, cellY + dy) * randomness;
            const pointY = cellY + dy + this._pseudoRandom(cellX + dx + 1, cellY + dy + 1) * randomness;

            const dist = Math.sqrt((u - pointX) ** 2 + (v - pointY) ** 2);
            
            if (dist < minDist) {
              secondMinDist = minDist;
              minDist = dist;
            } else if (dist < secondMinDist) {
              secondMinDist = dist;
            }
          }
        }

        let value;
        switch (cellType) {
          case "distance":
            value = 1.0 - Math.min(minDist, 1.0);
            break;
          case "distance2":
            value = 1.0 - Math.min(secondMinDist, 1.0);
            break;
          case "crackle":
            value = Math.min(secondMinDist - minDist, 1.0);
            break;
          default:
            value = 1.0 - Math.min(minDist, 1.0);
        }

        const color = Math.floor(value * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    this.drawParameterInfo(ctx, { scale, type: cellType, rand: randomness });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderRidgedNoise(ctx, node) {
    const scale = this.toSafeNumber(this.getParameterValue(node, "scale", 4.0), 4.0);
    const octaves = Math.max(1, Math.min(8, Math.round(this.toSafeNumber(this.getParameterValue(node, "octaves", 4), 4))));
    const ridge = this.toSafeNumber(this.getParameterValue(node, "ridge", 1.0), 1.0);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;

        let noise = 0;
        let amplitude = 1;
        let frequency = 1;

        for (let i = 0; i < octaves; i++) {
          let n = this._simpleNoise(u * frequency, v * frequency);
          n = ridge - Math.abs(n); // Ridge transformation
          n = n * n; // Sharp ridges
          noise += n * amplitude;
          amplitude *= 0.5;
          frequency *= 2;
        }

        const color = Math.floor(Math.max(0, Math.min(255, noise * 255)));
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    this.drawParameterInfo(ctx, { scale, octaves, ridge });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderTurbulence(ctx, node) {
    const scale = this.toSafeNumber(this.getParameterValue(node, "scale", 3.0), 3.0);
    const power = this.toSafeNumber(this.getParameterValue(node, "power", 1.0), 1.0);
    const roughness = this.toSafeNumber(this.getParameterValue(node, "roughness", 2.0), 2.0);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;

        // Turbulence using domain distortion
        const distortX = this._simpleNoise(u * roughness, v * roughness) * power;
        const distortY = this._simpleNoise(u * roughness + 100, v * roughness + 100) * power;

        const noise = this._simpleNoise(u + distortX, v + distortY);
        const color = Math.floor((Math.abs(noise) * 0.5 + 0.5) * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    this.drawParameterInfo(ctx, { scale, power, rough: roughness });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  // Enhanced noise utility functions
  _simpleNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const a = this._hash2D(ix, iy);
    const b = this._hash2D(ix + 1, iy);
    const c = this._hash2D(ix, iy + 1);
    const d = this._hash2D(ix + 1, iy + 1);

    // Smoothstep interpolation for better quality
    const u = fx * fx * (3.0 - 2.0 * fx);
    const v = fy * fy * (3.0 - 2.0 * fy);

    return (
      a * (1 - u) * (1 - v) + 
      b * u * (1 - v) + 
      c * (1 - u) * v + 
      d * u * v
    );
  }

  _hash2D(x, y) {
    // Improved hash function
    let h = Math.sin(x * 12.9898 + y * 78.233 + x * y * 37.719) * 43758.5453;
    return (h - Math.floor(h)) * 2 - 1;
  }

  _pseudoRandom(x, y) {
    // Better pseudo-random function
    const h = Math.sin(x * 12.9898 + y * 78.233 + x * y * 37.719) * 43758.5453;
    return (h - Math.floor(h));
  }

  // Fractal noise helper
  _fractalNoise(x, y, octaves, persistence, lacunarity) {
    let noise = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      noise += this._simpleNoise(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return noise / maxValue;
  }
}