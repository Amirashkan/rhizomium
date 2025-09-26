// src/core/preview/renderers/VectorRenderers.js - Updated with expression support

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
      
      // Direct fallback to node parameters
      return node.params?.[paramName] ?? defaultValue;
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

  renderDot(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    // Get vector inputs with expression support
    const aInput = inputs.a || this.getParameterValue(node, "a", [1, 0, 0]);
    const bInput = inputs.b || this.getParameterValue(node, "b", [0, 1, 0]);
    
    const a = this._toVec3(aInput);
    const b = this._toVec3(bInput);

    const dotResult = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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
    ctx.lineTo(centerX + a[0] * scale, centerY - a[1] * scale);
    ctx.stroke();

    // Vector B
    ctx.strokeStyle = "#44ff44";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + b[0] * scale, centerY - b[1] * scale);
    ctx.stroke();

    // Dot product visualization - angle arc
    const angleA = Math.atan2(a[1], a[0]);
    const angleB = Math.atan2(b[1], b[0]);
    let angleDiff = Math.abs(angleB - angleA);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

    ctx.strokeStyle = "#ffffff80";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, scale * 0.3, 
           Math.min(angleA, angleB), 
           Math.max(angleA, angleB));
    ctx.stroke();

    // Result
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(dotResult.toFixed(2), centerX, this.size - 6);

    // Expression indicator
    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderCross(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const aInput = inputs.a || this.getParameterValue(node, "a", [1, 0, 0]);
    const bInput = inputs.b || this.getParameterValue(node, "b", [0, 1, 0]);
    
    const a = this._toVec3(aInput);
    const b = this._toVec3(bInput);

    const cross = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
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
    ctx.lineTo(centerX + a[0] * scale, centerY - a[1] * scale);
    ctx.stroke();

    // Vector B
    ctx.strokeStyle = "#44ff44";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + b[0] * scale, centerY - b[1] * scale);
    ctx.stroke();

    // Cross product result (perpendicular to both)
    if (magnitude > 0.001) {
      ctx.strokeStyle = "#4444ff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + cross[0] * scale * 0.5,
        centerY - cross[1] * scale * 0.5
      );
      ctx.stroke();
    }

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

    // Magnitude text
    ctx.fillStyle = "#fff";
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`|${magnitude.toFixed(2)}|`, centerX, this.size - 6);

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderNormalize(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const vecInput = inputs.vec || inputs.a || this.getParameterValue(node, "vec", [1, 0.5, 0]);
    const vec = this._toVec3(vecInput);

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

    // Unit circle
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, scale, 0, Math.PI * 2);
    ctx.stroke();

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

    // Arrow head
    if (length > 0.001) {
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

    // Length text
    ctx.fillStyle = "#fff";
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`L:${length.toFixed(2)}`, centerX, this.size - 6);

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderLength(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const vecInput = inputs.vec || inputs.a || this.getParameterValue(node, "vec", [1, 1, 0]);
    const vec = this._toVec3(vecInput);

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

    // Component values
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`X:${vec[0].toFixed(1)}`, 2, 10);
    ctx.fillText(`Y:${vec[1].toFixed(1)}`, 2, 18);
    ctx.fillText(`Z:${vec[2].toFixed(1)}`, 2, 26);

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderDistance(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const aInput = inputs.a || this.getParameterValue(node, "a", [0, 0, 0]);
    const bInput = inputs.b || this.getParameterValue(node, "b", [1, 1, 0]);
    
    const vecA = this._toVec3(aInput);
    const vecB = this._toVec3(bInput);

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

    // Component difference display
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`ΔX:${diff[0].toFixed(1)}`, 2, 10);
    ctx.fillText(`ΔY:${diff[1].toFixed(1)}`, 2, 18);
    ctx.fillText(`ΔZ:${diff[2].toFixed(1)}`, 2, 26);

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderReflect(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const incidentInput = inputs.i || inputs.a || this.getParameterValue(node, "incident", [1, -1, 0]);
    const normalInput = inputs.n || inputs.b || this.getParameterValue(node, "normal", [0, 1, 0]);
    
    const I = this._toVec3(incidentInput);
    const N = this._toVec3(normalInput);

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

    // Angle indicators
    const incidentAngle = Math.atan2(-I[1], -I[0]);
    const reflectedAngle = Math.atan2(-R[1], R[0]);
    
    ctx.strokeStyle = "#ffffff40";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, scale * 0.2, incidentAngle, Math.atan2(N[1], N[0]), false);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, scale * 0.2, Math.atan2(N[1], N[0]), reflectedAngle, false);
    ctx.stroke();

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderRefract(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const incidentInput = inputs.i || inputs.a || this.getParameterValue(node, "incident", [1, -1, 0]);
    const normalInput = inputs.n || inputs.b || this.getParameterValue(node, "normal", [0, 1, 0]);
    const etaValue = this.toSafeNumber(inputs.eta || inputs.c || this.getParameterValue(node, "eta", 1.5), 1.5);

    const I = this._toVec3(incidentInput);
    const N = this._toVec3(normalInput);

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
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + N[0] * scale * 0.5, centerY - N[1] * scale * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Refracted ray (simplified calculation for 2D visualization)
    try {
      const incidentAngle = Math.acos(-I[1]);
      const sinIncident = Math.sin(incidentAngle);
      const sinRefracted = sinIncident / etaValue;
      
      if (sinRefracted <= 1) { // No total internal reflection
        const refractionAngle = Math.asin(sinRefracted);
        const refractedX = Math.sin(refractionAngle);
        const refractedY = -Math.cos(refractionAngle);

        ctx.strokeStyle = "#44ff44";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + refractedX * scale, centerY + refractedY * scale);
        ctx.stroke();
      } else {
        // Total internal reflection
        ctx.fillStyle = "#ff4444";
        ctx.font = "6px monospace";
        ctx.textAlign = "center";
        ctx.fillText("TIR", centerX, centerY + 20);
      }
    } catch (error) {
      // Fallback for calculation errors
      ctx.strokeStyle = "#44ff44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX, centerY + scale);
      ctx.stroke();
    }

    // Eta value
    ctx.fillStyle = "#fff";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`η=${etaValue.toFixed(1)}`, centerX, this.size - 6);

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  _toVec3(input) {
    // Handle expression-evaluated results
    if (typeof input === 'number') {
      return [input, input, input];
    }
    
    if (Array.isArray(input)) {
      // Ensure all elements are numbers
      const vec = input.map(v => this.toSafeNumber(v, 0));
      
      if (vec.length >= 3) return [vec[0], vec[1], vec[2]];
      if (vec.length === 2) return [vec[0], vec[1], 0];
      if (vec.length === 1) return [vec[0], vec[0], vec[0]];
    }
    
    // Handle objects with x, y, z properties
    if (input && typeof input === 'object') {
      const x = this.toSafeNumber(input.x, 0);
      const y = this.toSafeNumber(input.y, 0);
      const z = this.toSafeNumber(input.z, 0);
      return [x, y, z];
    }
    
    return [0, 0, 0];
  }
}