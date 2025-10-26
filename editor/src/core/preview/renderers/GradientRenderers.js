// src/core/preview/renderers/GradientRenderers.js
export class GradientRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      'lineargradient': (ctx, node) => this.renderLinearGradient(ctx, node),
      'radialgradient': (ctx, node) => this.renderRadialGradient(ctx, node),
      'angulargradient': (ctx, node) => this.renderAngularGradient(ctx, node),
      'conicgradient': (ctx, node) => this.renderConicGradient(ctx, node),
      'colorramp': (ctx, node) => this.renderColorRamp(ctx, node),
    });
  }

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
  return node.params?.[paramName] ?? defaultValue;
}

  renderLinearGradient(ctx, node) {
    const angle = this.getParameterValue(node, 'angle', 0.0);
    const offset = this.getParameterValue(node, 'offset', 0.0);
    const scale = this.getParameterValue(node, 'scale', 1.0);
    const repeat = this.getParameterValue(node, 'repeat', false);

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    const gradient = ctx.createLinearGradient(
      this.size / 2 - cos * this.size / 2,
      this.size / 2 - sin * this.size / 2,
      this.size / 2 + cos * this.size / 2,
      this.size / 2 + sin * this.size / 2
    );

    if (repeat) {
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const intensity = Math.floor((t * scale + offset) % 1.0 * 255);
        gradient.addColorStop(t, `rgb(${intensity}, ${intensity}, ${intensity})`);
      }
    } else {
      gradient.addColorStop(0, '#000000');
      gradient.addColorStop(1, '#ffffff');
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.size, this.size);
  }

  renderRadialGradient(ctx, node) {
    // Consistent Y-coordinate flipping across all gradient renderers
    const centerX = this.getParameterValue(node, 'centerX', 0.5) * this.size;
    const centerY = (1.0 - this.getParameterValue(node, 'centerY', 0.5)) * this.size;
    const rawRadius = this.getParameterValue(node, 'radius', 0.5);
    const radius = Math.max(1.0, Math.abs(rawRadius) * this.size);
    const falloff = this.getParameterValue(node, 'falloff', 1.0);
    const invert = this.getParameterValue(node, 'invert', false);

    const gradient = ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, radius
    );

    if (invert) {
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, '#000000');
    } else {
      gradient.addColorStop(0, '#000000');
      gradient.addColorStop(1, '#ffffff');
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.size, this.size);

    if (falloff !== 1.0) {
      const imageData = ctx.getImageData(0, 0, this.size, this.size);
      const data = imageData.data;

      for (let y = 0; y < this.size; y++) {
        for (let x = 0; x < this.size; x++) {
          const dx = (x - centerX) / radius;
          const dy = (y - centerY) / radius;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const value = Math.pow(Math.min(1, dist), falloff);
          const intensity = invert ? (1 - value) * 255 : value * 255;

          const idx = (y * this.size + x) * 4;
          data[idx] = data[idx + 1] = data[idx + 2] = intensity;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }
  }

  renderAngularGradient(ctx, node) {
    const centerX = this.getParameterValue(node, 'centerX', 0.5) * this.size;
    const centerY = (1.0 - this.getParameterValue(node, 'centerY', 0.5)) * this.size;
    const rotation = this.getParameterValue(node, 'rotation', 0.0);
    const repeat = this.getParameterValue(node, 'repeat', 1.0);

    const imageData = ctx.createImageData(this.size, this.size);
    const data = imageData.data;

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        let angle = Math.atan2(dy, dx) + rotation;
        
        let t = (angle / (Math.PI * 2) + 0.5) % 1.0;
        t = (t * repeat) % 1.0;
        
        const intensity = t * 255;
        const idx = (y * this.size + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = intensity;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  renderConicGradient(ctx, node) {
    const centerX = this.getParameterValue(node, 'centerX', 0.5) * this.size;
    const centerY = (1.0 - this.getParameterValue(node, 'centerY', 0.5)) * this.size;
    const startAngle = this.getParameterValue(node, 'startAngle', 0.0);
    const endAngle = this.getParameterValue(node, 'endAngle', Math.PI * 2);
    const smoothness = this.getParameterValue(node, 'smoothness', 0.0);

    const imageData = ctx.createImageData(this.size, this.size);
    const data = imageData.data;

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const angle = Math.atan2(dy, dx);
        
        let t = (angle - startAngle) / (endAngle - startAngle);
        t = Math.max(0, Math.min(1, t));
        
        if (smoothness > 0) {
          t = t * t * (3 - 2 * t);
        }
        
        const intensity = t * 255;
        const idx = (y * this.size + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = intensity;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  renderColorRamp(ctx, node) {
    // Placeholder for color ramp implementation
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, this.size, this.size);
  }
}
