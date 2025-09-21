// src/core/preview/renderers/NoiseRenderers.js

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
      'voronoinoise': (ctx, node) => this.renderVoronoiNoise(ctx, node)
    });
  }

  renderRandom(ctx, node) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const noise = Math.random();
        const color = Math.floor(noise * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  renderValueNoise(ctx, node) {
    const scale = node.props?.scale ?? 5.0;

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;

        const noise = this._simpleNoise(u, v);
        const color = Math.floor((noise * 0.5 + 0.5) * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  renderFBMNoise(ctx, node) {
    const scale = node.props?.scale ?? 3.0;
    const octaves = node.props?.octaves ?? 4;

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
          amplitude *= 0.5;
          frequency *= 2;
        }

        noise /= maxValue;
        const color = Math.floor((noise * 0.5 + 0.5) * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  renderSimplexNoise(ctx, node) {
    const scale = node.props?.scale ?? 4.0;

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;

        const noise =
          this._simpleNoise(u * 1.5, v * 1.5) * 0.7 +
          this._simpleNoise(u * 3, v * 3) * 0.3;
        const color = Math.floor((noise * 0.5 + 0.5) * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  renderVoronoiNoise(ctx, node) {
    const scale = node.props?.scale ?? 8.0;

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = (x / this.size) * scale;
        const v = (y / this.size) * scale;

        const cellX = Math.floor(u);
        const cellY = Math.floor(v);

        let minDist = 999;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const pointX =
              cellX + dx + this._pseudoRandom(cellX + dx, cellY + dy);
            const pointY =
              cellY + dy + this._pseudoRandom(cellX + dx + 1, cellY + dy + 1);

            const dist = Math.sqrt((u - pointX) ** 2 + (v - pointY) ** 2);
            minDist = Math.min(minDist, dist);
          }
        }

        const color = Math.floor((1.0 - Math.min(minDist, 1.0)) * 255);
        ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // Noise utility functions
  _simpleNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const a = this._hash2D(ix, iy);
    const b = this._hash2D(ix + 1, iy);
    const c = this._hash2D(ix, iy + 1);
    const d = this._hash2D(ix + 1, iy + 1);

    const u = fx * fx * (3.0 - 2.0 * fx);
    const v = fy * fy * (3.0 - 2.0 * fy);

    return (
      a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
    );
  }

  _hash2D(x, y) {
    const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (h - Math.floor(h)) * 2 - 1;
  }

  _pseudoRandom(x, y) {
    return (((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) + 1) * 0.5;
  }
}