export class GradientRenderers {
  static renderLinearGradient(ctx, size, node, computer) {
    const angle = computer.getNodeParameter(node, 'angle', 0.0);
    const offset = computer.getNodeParameter(node, 'offset', 0.0);
    const scale = computer.getNodeParameter(node, 'scale', 1.0);
    const repeat = computer.getNodeParameter(node, 'repeat', false);

    // Create gradient
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    const gradient = ctx.createLinearGradient(
      size / 2 - cos * size / 2,
      size / 2 - sin * size / 2,
      size / 2 + cos * size / 2,
      size / 2 + sin * size / 2
    );

    if (repeat) {
      // Create repeating gradient effect
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
    ctx.fillRect(0, 0, size, size);
  }

  static renderRadialGradient(ctx, size, node, computer) {
    const centerX = computer.getNodeParameter(node, 'centerX', 0.5) * size;
    const centerY = computer.getNodeParameter(node, 'centerY', 0.5) * size;
    const radius = computer.getNodeParameter(node, 'radius', 0.5) * size;
    const falloff = computer.getNodeParameter(node, 'falloff', 1.0);
    const invert = computer.getNodeParameter(node, 'invert', false);

    // Create radial gradient
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
    ctx.fillRect(0, 0, size, size);

    // Apply falloff by rendering with multiple layers
    if (falloff !== 1.0) {
      const imageData = ctx.getImageData(0, 0, size, size);
      const data = imageData.data;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x - centerX) / radius;
          const dy = (y - centerY) / radius;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const value = Math.pow(Math.min(1, dist), falloff);
          const intensity = invert ? (1 - value) * 255 : value * 255;

          const idx = (y * size + x) * 4;
          data[idx] = data[idx + 1] = data[idx + 2] = intensity;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }
  }

  static renderAngularGradient(ctx, size, node, computer) {
    const centerX = computer.getNodeParameter(node, 'centerX', 0.5) * size;
    const centerY = computer.getNodeParameter(node, 'centerY', 0.5) * size;
    const rotation = computer.getNodeParameter(node, 'rotation', 0.0);
    const repeat = computer.getNodeParameter(node, 'repeat', 1.0);

    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        let angle = Math.atan2(dy, dx) + rotation;
        
        // Normalize to 0-1
        let t = (angle / (Math.PI * 2) + 0.5) % 1.0;
        t = (t * repeat) % 1.0;
        
        const intensity = t * 255;
        const idx = (y * size + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = intensity;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  static renderConicGradient(ctx, size, node, computer) {
    const centerX = computer.getNodeParameter(node, 'centerX', 0.5) * size;
    const centerY = computer.getNodeParameter(node, 'centerY', 0.5) * size;
    const startAngle = computer.getNodeParameter(node, 'startAngle', 0.0);
    const endAngle = computer.getNodeParameter(node, 'endAngle', Math.PI * 2);
    const smoothness = computer.getNodeParameter(node, 'smoothness', 0.0);

    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const angle = Math.atan2(dy, dx);
        
        let t = (angle - startAngle) / (endAngle - startAngle);
        t = Math.max(0, Math.min(1, t));
        
        // Apply smoothstep if needed
        if (smoothness > 0) {
          t = t * t * (3 - 2 * t);
        }
        
        const intensity = t * 255;
        const idx = (y * size + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = intensity;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  static renderColorRamp(ctx, size, node, computer) {
    const stops = node.params?.stops || [
      { position: 0.0, color: [0, 0, 0, 1] },
      { position: 1.0, color: [1, 1, 1, 1] }
    ];
    const mode = node.params?.mode || 'Linear';

    // Sort stops by position
    const sortedStops = [...stops].sort((a, b) => a.position - b.position);

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, size, 0);

    sortedStops.forEach(stop => {
      const c = stop.color;
      const r = Math.round(c[0] * 255);
      const g = Math.round(c[1] * 255);
      const b = Math.round(c[2] * 255);
      gradient.addColorStop(stop.position, `rgb(${r}, ${g}, ${b})`);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // Add mode indicator
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(2, size - 12, size - 4, 10);
    ctx.fillStyle = '#fff';
    ctx.font = '8px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(mode, size / 2, size - 4);
  }
}