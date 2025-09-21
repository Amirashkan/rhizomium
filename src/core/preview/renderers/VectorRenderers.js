// src/core/preview/renderers/VectorRenderers.js

export class VectorRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      'dot': (ctx, node) => this.renderDot(ctx, node),
      'cross': (ctx, node) => this.renderCross(ctx, node),
      'normalize': (ctx, node) => this.renderNormalize(ctx, node),
      'length': (ctx, node) => this.renderLength(ctx, node),
      'distance': (ctx, node) => this.renderDistance(ctx, node),
      'reflect': (ctx, node) => this.renderReflect(ctx, node),
      'refract': (ctx, node) => this.renderRefract(ctx, node)
    });
  }

  renderDot(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const a = inputs.a || [1, 0, 0];
    const b = inputs.b || [0, 1, 0];

    const vecA = this._toVec3(a);
    const vecB = this._toVec3(b);

    const dotResult = vecA[0] * vecB[0] + vecA[1] * vecB[1] + vecA[2] * vecB[2];

    const normalized = (dotResult + 1) / 2;
    const hue = normalized * 240;

    ctx.fillStyle = `hsl(${hue}, 70%, 40%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.3;

    // Vector A
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + vecA[0] * scale, centerY - vecA[1] * scale);
    ctx.stroke();

    // Vector B
    ctx.strokeStyle = "#44ff44";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + vecB[0] * scale, centerY - vecB[1] * scale);
    ctx.stroke();

    // Result
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(dotResult.toFixed(2), centerX, this.size - 6);
  }

  renderCross(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const a = inputs.a || [1, 0, 0];
    const b = inputs.b || [0, 1, 0];

    const vecA = this._toVec3(a);
    const vecB = this._toVec3(b);

    const cross = [
      vecA[1] * vecB[2] - vecA[2] * vecB[1],
      vecA[2] * vecB[0] - vecA[0] * vecB[2],
      vecA[0] * vecB[1] - vecA[1] * vecB[0],
    ];

    const magnitude = Math.sqrt(
      cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]
    );
    const intensity = Math.min(1, magnitude);

    ctx.fillStyle = `hsl(280, 70%, ${20 + intensity * 40}%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.3;

    // Vector A
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + vecA[0] * scale, centerY - vecA[1] * scale);
    ctx.stroke();

    // Vector B
    ctx.strokeStyle = "#44ff44";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + vecB[0] * scale, centerY - vecB[1] * scale);
    ctx.stroke();

    // Cross product result
    ctx.strokeStyle = "#4444ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + cross[0] * scale * 0.5,
      centerY - cross[1] * scale * 0.5
    );
    ctx.stroke();

    // Cross symbol
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    const crossSize = 6;
    ctx.beginPath();
    ctx.moveTo(centerX - crossSize, centerY - crossSize);
    ctx.lineTo(centerX + crossSize, centerY + crossSize);
    ctx.moveTo(centerX + crossSize, centerY - crossSize);
    ctx.lineTo(centerX - crossSize, centerY + crossSize);
    ctx.stroke();
  }

  renderNormalize(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = inputs.vec || inputs.a || [1, 0.5, 0];
    const vec = this._toVec3(input);

    const length = Math.sqrt(
      vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]
    );
    const normalized =
      length > 0
        ? [vec[0] / length, vec[1] / length, vec[2] / length]
        : [0, 0, 0];

    ctx.fillStyle = "#1a2332";
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.4;

    // Original vector (dashed)
    if (length > 0.001) {
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + vec[0] * scale * 0.5,
        centerY - vec[1] * scale * 0.5
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Normalized vector
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + normalized[0] * scale,
      centerY - normalized[1] * scale
    );
    ctx.stroke();

    // Unit circle
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, scale, 0, Math.PI * 2);
    ctx.stroke();

    // Arrow head
    const angle = Math.atan2(-normalized[1], normalized[0]);
    const headLength = 6;
    const endX = centerX + normalized[0] * scale;
    const endY = centerY - normalized[1] * scale;

    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle - 0.5),
      endY + headLength * Math.sin(angle - 0.5)
    );
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle + 0.5),
      endY + headLength * Math.sin(angle + 0.5)
    );
    ctx.stroke();
  }

  renderLength(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = inputs.vec || inputs.a || [1, 1, 0];
    const vec = this._toVec3(input);

    const length = Math.sqrt(
      vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]
    );

    const normalizedLength = Math.min(1, length / 2);
    const hue = normalizedLength * 120;

    ctx.fillStyle = `hsl(${hue}, 70%, 30%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.3;

    // Vector
    if (length > 0.001) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + (vec[0] / length) * scale * normalizedLength * 2,
        centerY - (vec[1] / length) * scale * normalizedLength * 2
      );
      ctx.stroke();
    }

    // Length bar
    const barWidth = this.size * 0.8;
    const barHeight = 6;
    const barY = this.size - 12;

    ctx.fillStyle = "#333";
    ctx.fillRect((this.size - barWidth) / 2, barY, barWidth, barHeight);

    ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
    ctx.fillRect(
      (this.size - barWidth) / 2,
      barY,
      barWidth * normalizedLength,
      barHeight
    );

    // Length text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(length.toFixed(2), centerX, barY - 2);
  }

  renderDistance(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const a = inputs.a || [0, 0, 0];
    const b = inputs.b || [1, 1, 0];

    const vecA = this._toVec3(a);
    const vecB = this._toVec3(b);

    const diff = [vecB[0] - vecA[0], vecB[1] - vecA[1], vecB[2] - vecA[2]];
    const distance = Math.sqrt(
      diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2]
    );

    const normalizedDist = Math.min(1, distance / 2);
    const hue = 200 - normalizedDist * 100;

    ctx.fillStyle = `hsl(${hue}, 70%, 25%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.2;

    const pointA = [centerX + vecA[0] * scale, centerY - vecA[1] * scale];
    const pointB = [centerX + vecB[0] * scale, centerY - vecB[1] * scale];

    // Distance line
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pointA[0], pointA[1]);
    ctx.lineTo(pointB[0], pointB[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Points
    ctx.fillStyle = "#ff4444";
    ctx.beginPath();
    ctx.arc(pointA[0], pointA[1], 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#44ff44";
    ctx.beginPath();
    ctx.arc(pointB[0], pointB[1], 3, 0, Math.PI * 2);
    ctx.fill();

    // Distance text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(distance.toFixed(2), centerX, this.size - 6);
  }

  renderReflect(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const incident = inputs.i || inputs.a || [1, -1, 0];
    const normal = inputs.n || inputs.b || [0, 1, 0];

    const I = this._toVec3(incident);
    const N = this._toVec3(normal);

    const dotNI = N[0] * I[0] + N[1] * I[1] + N[2] * I[2];
    const R = [
      I[0] - 2 * dotNI * N[0],
      I[1] - 2 * dotNI * N[1],
      I[2] - 2 * dotNI * N[2],
    ];

    ctx.fillStyle = "#0f1419";
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.3;

    // Surface
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const surfaceLength = this.size * 0.6;
    ctx.moveTo(
      centerX - (N[1] * surfaceLength) / 2,
      centerY + (N[0] * surfaceLength) / 2
    );
    ctx.lineTo(
      centerX + (N[1] * surfaceLength) / 2,
      centerY - (N[0] * surfaceLength) / 2
    );
    ctx.stroke();

    // Incident ray
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - I[0] * scale, centerY + I[1] * scale);
    ctx.lineTo(centerX, centerY);
    ctx.stroke();

    // Normal
    ctx.strokeStyle = "#ffff44";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + N[0] * scale * 0.7, centerY - N[1] * scale * 0.7);
    ctx.stroke();

    // Reflected ray
    ctx.strokeStyle = "#44ffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + R[0] * scale, centerY - R[1] * scale);
    ctx.stroke();
  }

  renderRefract(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const incident = inputs.i || inputs.a || [1, -1, 0];
    const normal = inputs.n || inputs.b || [0, 1, 0];
    const eta = inputs.eta || inputs.c || 1.5;

    const I = this._toVec3(incident);
    const N = this._toVec3(normal);

    ctx.fillStyle = "#0a0a1a";
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.3;

    // Interface
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const interfaceLength = this.size * 0.8;
    ctx.moveTo(
      centerX - (N[1] * interfaceLength) / 2,
      centerY + (N[0] * interfaceLength) / 2
    );
    ctx.lineTo(
      centerX + (N[1] * interfaceLength) / 2,
      centerY - (N[0] * interfaceLength) / 2
    );
    ctx.stroke();

    // Incident ray
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - I[0] * scale, centerY + I[1] * scale);
    ctx.lineTo(centerX, centerY);
    ctx.stroke();

    // Normal
    ctx.strokeStyle = "#ffff44";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + N[0] * scale * 0.5, centerY - N[1] * scale * 0.5);
    ctx.stroke();

    // Refracted ray
    const refractionAngle = Math.asin(Math.sin(Math.acos(-I[1])) / eta);
    const refractedX = Math.sin(refractionAngle);
    const refractedY = -Math.cos(refractionAngle);

    ctx.strokeStyle = "#44ff44";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + refractedX * scale, centerY + refractedY * scale);
    ctx.stroke();

    // Eta value
    ctx.fillStyle = "#fff";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`η=${eta.toFixed(1)}`, centerX, this.size - 6);
  }

  _toVec3(input) {
    if (Array.isArray(input)) {
      if (input.length >= 3) return [input[0], input[1], input[2]];
      if (input.length === 2) return [input[0], input[1], 0];
      if (input.length === 1) return [input[0], input[0], input[0]];
    }
    if (typeof input === "number") return [input, input, input];
    return [0, 0, 0];
  }
}