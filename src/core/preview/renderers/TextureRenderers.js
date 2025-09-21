// src/core/preview/renderers/TextureRenderers.js

export class TextureRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      'texture2d': (ctx, node) => this.renderTexture2D(ctx, node),
      'texturecube': (ctx, node) => this.renderTextureCube(ctx, node),
      'circle': (ctx, node) => this.renderCircle(ctx, node),
      'circlefield': (ctx, node) => this.renderCircle(ctx, node)
    });
  }

  renderTexture2D(ctx, node) {
    console.log(
      "🔍 TEXTURE PREVIEW DEBUG: renderTexture2D called for node",
      node.id,
      "size:",
      this.size
    );

    // Check if texture is loaded
    const textureInfo = window.textureManager?.getTexture(node.id);
    console.log("Texture info for node", node.id, ":", textureInfo);

    if (textureInfo && textureInfo.file) {
      // Try to create image from file
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, this.size, this.size);
        ctx.drawImage(img, 0, 0, this.size, this.size);

        // Add indicator
        ctx.fillStyle = "rgba(74, 144, 226, 0.9)";
        ctx.fillRect(0, 0, 14, 10);
        ctx.fillStyle = "white";
        ctx.font = "bold 8px Arial";
        ctx.fillText("2D", 2, 8);
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
      // No texture - show clear placeholder
      ctx.fillStyle = "#444";
      ctx.fillRect(0, 0, this.size, this.size);

      // Bright border
      ctx.strokeStyle = "#4a90e2";
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, this.size - 4, this.size - 4);

      // Clear text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.fillText("2D", this.size / 2, this.size / 2 - 4);
      ctx.fillText("TEX", this.size / 2, this.size / 2 + 10);
    }

    console.log(
      "🎨 TEXTURE PREVIEW: Returning canvas:",
      "dimensions:",
      this.size,
      "x",
      this.size
    );
  }

  renderTextureCube(ctx, node) {
    // Placeholder for cube texture rendering
    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, this.size, this.size);

    // Draw a simple cube wireframe
    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const cubeSize = this.size * 0.3;

    ctx.strokeStyle = "#4a90e2";
    ctx.lineWidth = 2;

    // Front face
    ctx.strokeRect(
      centerX - cubeSize,
      centerY - cubeSize,
      cubeSize * 2,
      cubeSize * 2
    );

    // Back face (offset)
    const offset = cubeSize * 0.3;
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
  }

  renderCircle(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);

    let radius = 0.25;
    if (inputs.a !== undefined) {
      radius = inputs.a;
    } else if (node.props?.radius !== undefined) {
      radius = node.props.radius;
    }

    let epsilon = 0.02;
    if (inputs.b !== undefined) {
      epsilon = inputs.b;
    } else if (node.props?.epsilon !== undefined) {
      epsilon = node.props.epsilon;
    }

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, this.size, this.size);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = x / this.size;
        const v = y / this.size;
        const dist = Math.sqrt((u - 0.5) * (u - 0.5) + (v - 0.5) * (v - 0.5));
        const safeEpsilon = Math.max(epsilon, 0.0001);
        const field =
          1.0 -
          this._smoothstep(radius - safeEpsilon, radius + safeEpsilon, dist);

        if (field > 0.01) {
          const intensity = Math.max(0, Math.min(1, field));
          const color = Math.floor(intensity * 255);
          ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  _smoothstep(edge0, edge1, x) {
    const t = Math.max(
      0,
      Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0))
    );
    return t * t * (3 - 2 * t);
  }
}