// PreviewSystem.js

export class PreviewSystem {
  constructor(editor) {
    this.editor = editor;
    this.canvasCache = new Map();
    this.size = 48;
  }

  renderTexture2D(node, size) {
    console.log(
      "🔍 TEXTURE PREVIEW DEBUG: renderTexture2D called for node",
      node.id,
      "size:",
      size,
    );

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    // Check if texture is loaded
    const textureInfo = window.textureManager?.getTexture(node.id);
    console.log("Texture info for node", node.id, ":", textureInfo);

    if (textureInfo && textureInfo.file) {
      // Try to create image from file
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);

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
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#4a90e2";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Loading...", size / 2, size / 2);
    } else {
      // No texture - show clear placeholder
      ctx.fillStyle = "#444";
      ctx.fillRect(0, 0, size, size);

      // Bright border
      ctx.strokeStyle = "#4a90e2";
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, size - 4, size - 4);

      // Clear text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.fillText("2D", size / 2, size / 2 - 4);
      ctx.fillText("TEX", size / 2, size / 2 + 10);
    }

    console.log(
      "🎨 TEXTURE PREVIEW: Returning canvas:",
      canvas,
      "dimensions:",
      canvas.width,
      "x",
      canvas.height,
    );
    return canvas;
  }

  // Generate preview for a single node
  generateNodePreview(node) {
    console.log("Generating preview for:", node.kind, node.kind.toLowerCase());

    if (!this.editor.isPreviewEnabled) {
      node.__thumb = null;
      return;
    }

    try {
      const canvas = this.getCanvas(node.id);
      const ctx = canvas.getContext("2d");

      // Clear
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, this.size, this.size);

      // Route to specific renderer
      switch (node.kind.toLowerCase()) {
        case "texture2d":
          const canvas = this.renderTexture2D(node, size);
          this.previewCache.set(node.id, canvas);
        case "constfloat":
        case "float":
          this.renderFloat(ctx, node);
          break;
        case "constvec3":
        case "vec3":
          this.renderVec3(ctx, node);
          break;
        case "multiply":
          this.renderMath(ctx, node, "×", "#f59e0b");
          break;
        case "add":
          this.renderMath(ctx, node, "+", "#60a5fa");
          break;
        case "subtract":
          this.renderMath(ctx, node, "−", "#f87171");
          break;
        case "divide":
          this.renderMath(ctx, node, "÷", "#a78bfa");
          break;
        case "circle":
        case "circlefield":
          this.renderCircle(ctx, node);
          break;
        case "uv":
          this.renderUV(ctx, node);
          break;
        case "time":
          this.renderTime(ctx, node);
          break;
        case "expr":
          this.renderExpression(ctx, node);
          break;
        case "saturate":
          this.renderSaturate(ctx, node);
          break;
        case "output":
        case "outputfinal":
          this.renderOutput(ctx, node);
          break;
        case "random":
          this.renderRandom(ctx, node);
          break;
        case "valuenoise":
          this.renderValueNoise(ctx, node);
          break;
        case "fbmnoise":
          this.renderFBMNoise(ctx, node);
          break;
        case "simplexnoise":
          this.renderSimplexNoise(ctx, node);
          break;
        case "voronoinoise":
          this.renderVoronoiNoise(ctx, node);
          break;
        case "dot":
          this.renderDot(ctx, node);
          break;
        case "cross":
          this.renderCross(ctx, node);
          break;
        case "normalize":
          this.renderNormalize(ctx, node);
          break;
        case "length":
          this.renderLength(ctx, node);
          break;
        case "distance":
          this.renderDistance(ctx, node);
          break;
        case "reflect":
          this.renderReflect(ctx, node);
          break;
        case "refract":
          this.renderRefract(ctx, node);
          break;
        case "texture2d":
          const textureCanvas = this.renderTexture2D(node, 64);
          ctx.drawImage(textureCanvas, 0, 0);
          break;
        case "texturecube":
          const cubeCanvas = this.renderTextureCube(node, 64);
          ctx.drawImage(cubeCanvas, 0, 0);
          break;
      }
      node.__thumb = canvas;
    } catch (error) {
      console.warn("Preview failed:", node.kind, error);
      const canvas = this.getCanvas(node.id);
      const ctx = canvas.getContext("2d");
      this.renderError(ctx, node);
      node.__thumb = canvas;
    }
  }

  // Update all previews
  updateAllPreviews() {
    if (!this.editor.graph?.nodes) return;

    this.editor.graph.nodes.forEach((node) => {
      this.generateNodePreview(node);
    });

    this.editor.draw();
  }

  // FIXED: Vec3 renderer added
  renderVec3(ctx, node) {
    // SAFE parameter access with type conversion and fallbacks
    let x = this.getParameter(node, "x");
    let y = this.getParameter(node, "y");
    let z = this.getParameter(node, "z");

    // Convert to numbers and provide fallbacks
    x = typeof x === "number" ? x : parseFloat(x) || 0;
    y = typeof y === "number" ? y : parseFloat(y) || 0;
    z = typeof z === "number" ? z : parseFloat(z) || 0;

    // Clamp values to reasonable ranges
    x = Math.max(-10, Math.min(10, x));
    y = Math.max(-10, Math.min(10, y));
    z = Math.max(-10, Math.min(10, z));

    // Use RGB components
    const r = Math.abs(x) * 127 + 128;
    const g = Math.abs(y) * 127 + 128;
    const b = Math.abs(z) * 127 + 128;

    ctx.fillStyle = `rgb(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)})`;
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 6px monospace";
    ctx.textAlign = "center";

    // Safe toFixed calls
    ctx.fillText(`X:${x.toFixed(2)}`, this.size / 2, 10);
    ctx.fillText(`Y:${y.toFixed(2)}`, this.size / 2, 20);
    ctx.fillText(`Z:${z.toFixed(2)}`, this.size / 2, 30);
  }

  // Render methods
  renderFloat(ctx, node) {
    const value = this.getParameter(node, "value") || 0;
    const numValue = typeof value === "number" ? value : parseFloat(value) || 0;

    const intensity = Math.min(0.8, Math.abs(numValue) / 10);
    const hue = numValue >= 0 ? 120 : 0;

    ctx.fillStyle = `hsl(${hue}, 60%, ${10 + intensity * 30}%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = `hsl(${hue}, 80%, 80%)`;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const text =
      Math.abs(numValue) < 0.01
        ? numValue.toExponential(1)
        : numValue.toFixed(2);

    ctx.fillText(text, this.size / 2, this.size / 2);

    ctx.strokeStyle = `hsl(${hue}, 40%, 40%)`;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < this.size; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, this.size);
      ctx.moveTo(0, i);
      ctx.lineTo(this.size, i);
      ctx.stroke();
    }
  }

  renderMath(ctx, node, symbol, color) {
    const computedResult = this.computeNodeValue(node);
    const inputs = this.getConnectedInputs(node);

    let a, b;
    switch (node.kind.toLowerCase()) {
      case "divide":
      case "subtract":
        a = inputs.a !== undefined ? inputs.a : 1;
        b = inputs.b !== undefined ? inputs.b : 1;
        break;
      default:
        a = inputs.a !== undefined ? inputs.a : 1;
        b = inputs.b !== undefined ? inputs.b : 1;
    }

    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = color;
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(symbol, this.size / 2, this.size / 2 - 4);

    ctx.font = "8px monospace";
    const resultText =
      Math.abs(computedResult) < 0.01
        ? computedResult.toExponential(1)
        : computedResult.toFixed(2);
    ctx.fillText(resultText, this.size / 2, this.size / 2 + 12);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    const aText = Math.abs(a) < 0.01 ? a.toExponential(1) : a.toFixed(2);
    const bText = Math.abs(b) < 0.01 ? b.toExponential(1) : b.toFixed(2);
    ctx.fillText(`A:${aText}`, 2, 10);
    ctx.fillText(`B:${bText}`, 2, 18);
  }

  renderDot(ctx, node) {
    const inputs = this.getConnectedInputs(node);
    const a = inputs.a || [1, 0, 0];
    const b = inputs.b || [0, 1, 0];

    const vecA = this.toVec3(a);
    const vecB = this.toVec3(b);

    const dotResult = vecA[0] * vecB[0] + vecA[1] * vecB[1] + vecA[2] * vecB[2];

    const normalized = (dotResult + 1) / 2;
    const hue = normalized * 240;

    ctx.fillStyle = `hsl(${hue}, 70%, 40%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.3;

    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + vecA[0] * scale, centerY - vecA[1] * scale);
    ctx.stroke();

    ctx.strokeStyle = "#44ff44";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + vecB[0] * scale, centerY - vecB[1] * scale);
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(dotResult.toFixed(2), centerX, this.size - 6);
  }

  renderCross(ctx, node) {
    const inputs = this.getConnectedInputs(node);
    const a = inputs.a || [1, 0, 0];
    const b = inputs.b || [0, 1, 0];

    const vecA = this.toVec3(a);
    const vecB = this.toVec3(b);

    const cross = [
      vecA[1] * vecB[2] - vecA[2] * vecB[1],
      vecA[2] * vecB[0] - vecA[0] * vecB[2],
      vecA[0] * vecB[1] - vecA[1] * vecB[0],
    ];

    const magnitude = Math.sqrt(
      cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2],
    );
    const intensity = Math.min(1, magnitude);

    ctx.fillStyle = `hsl(280, 70%, ${20 + intensity * 40}%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.3;

    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + vecA[0] * scale, centerY - vecA[1] * scale);
    ctx.stroke();

    ctx.strokeStyle = "#44ff44";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + vecB[0] * scale, centerY - vecB[1] * scale);
    ctx.stroke();

    ctx.strokeStyle = "#4444ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + cross[0] * scale * 0.5,
      centerY - cross[1] * scale * 0.5,
    );
    ctx.stroke();

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
    const inputs = this.getConnectedInputs(node);
    const input = inputs.vec || inputs.a || [1, 0.5, 0];
    const vec = this.toVec3(input);

    const length = Math.sqrt(
      vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2],
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

    if (length > 0.001) {
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + vec[0] * scale * 0.5,
        centerY - vec[1] * scale * 0.5,
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + normalized[0] * scale,
      centerY - normalized[1] * scale,
    );
    ctx.stroke();

    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, scale, 0, Math.PI * 2);
    ctx.stroke();

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
      endY + headLength * Math.sin(angle - 0.5),
    );
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle + 0.5),
      endY + headLength * Math.sin(angle + 0.5),
    );
    ctx.stroke();
  }

  renderLength(ctx, node) {
    const inputs = this.getConnectedInputs(node);
    const input = inputs.vec || inputs.a || [1, 1, 0];
    const vec = this.toVec3(input);

    const length = Math.sqrt(
      vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2],
    );

    const normalizedLength = Math.min(1, length / 2);
    const hue = normalizedLength * 120;

    ctx.fillStyle = `hsl(${hue}, 70%, 30%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.3;

    if (length > 0.001) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + (vec[0] / length) * scale * normalizedLength * 2,
        centerY - (vec[1] / length) * scale * normalizedLength * 2,
      );
      ctx.stroke();
    }

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
      barHeight,
    );

    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(length.toFixed(2), centerX, barY - 2);
  }

  renderDistance(ctx, node) {
    const inputs = this.getConnectedInputs(node);
    const a = inputs.a || [0, 0, 0];
    const b = inputs.b || [1, 1, 0];

    const vecA = this.toVec3(a);
    const vecB = this.toVec3(b);

    const diff = [vecB[0] - vecA[0], vecB[1] - vecA[1], vecB[2] - vecA[2]];
    const distance = Math.sqrt(
      diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2],
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

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pointA[0], pointA[1]);
    ctx.lineTo(pointB[0], pointB[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#ff4444";
    ctx.beginPath();
    ctx.arc(pointA[0], pointA[1], 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#44ff44";
    ctx.beginPath();
    ctx.arc(pointB[0], pointB[1], 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(distance.toFixed(2), centerX, this.size - 6);
  }

  renderReflect(ctx, node) {
    const inputs = this.getConnectedInputs(node);
    const incident = inputs.i || inputs.a || [1, -1, 0];
    const normal = inputs.n || inputs.b || [0, 1, 0];

    const I = this.toVec3(incident);
    const N = this.toVec3(normal);

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

    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const surfaceLength = this.size * 0.6;
    ctx.moveTo(
      centerX - (N[1] * surfaceLength) / 2,
      centerY + (N[0] * surfaceLength) / 2,
    );
    ctx.lineTo(
      centerX + (N[1] * surfaceLength) / 2,
      centerY - (N[0] * surfaceLength) / 2,
    );
    ctx.stroke();

    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - I[0] * scale, centerY + I[1] * scale);
    ctx.lineTo(centerX, centerY);
    ctx.stroke();

    ctx.strokeStyle = "#ffff44";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + N[0] * scale * 0.7, centerY - N[1] * scale * 0.7);
    ctx.stroke();

    ctx.strokeStyle = "#44ffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + R[0] * scale, centerY - R[1] * scale);
    ctx.stroke();
  }

  renderRefract(ctx, node) {
    const inputs = this.getConnectedInputs(node);
    const incident = inputs.i || inputs.a || [1, -1, 0];
    const normal = inputs.n || inputs.b || [0, 1, 0];
    const eta = inputs.eta || inputs.c || 1.5;

    const I = this.toVec3(incident);
    const N = this.toVec3(normal);

    ctx.fillStyle = "#0a0a1a";
    ctx.fillRect(0, 0, this.size, this.size);

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const scale = this.size * 0.3;

    ctx.strokeStyle = "#666";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const interfaceLength = this.size * 0.8;
    ctx.moveTo(
      centerX - (N[1] * interfaceLength) / 2,
      centerY + (N[0] * interfaceLength) / 2,
    );
    ctx.lineTo(
      centerX + (N[1] * interfaceLength) / 2,
      centerY - (N[0] * interfaceLength) / 2,
    );
    ctx.stroke();

    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - I[0] * scale, centerY + I[1] * scale);
    ctx.lineTo(centerX, centerY);
    ctx.stroke();

    ctx.strokeStyle = "#ffff44";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + N[0] * scale * 0.5, centerY - N[1] * scale * 0.5);
    ctx.stroke();

    const refractionAngle = Math.asin(Math.sin(Math.acos(-I[1])) / eta);
    const refractedX = Math.sin(refractionAngle);
    const refractedY = -Math.cos(refractionAngle);

    ctx.strokeStyle = "#44ff44";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + refractedX * scale, centerY + refractedY * scale);
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`η=${eta.toFixed(1)}`, centerX, this.size - 6);
  }

  // Noise renderers
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

        const noise = this.simpleNoise(u, v);
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
          noise += this.simpleNoise(u * frequency, v * frequency) * amplitude;
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
          this.simpleNoise(u * 1.5, v * 1.5) * 0.7 +
          this.simpleNoise(u * 3, v * 3) * 0.3;
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
              cellX + dx + this.pseudoRandom(cellX + dx, cellY + dy);
            const pointY =
              cellY + dy + this.pseudoRandom(cellX + dx + 1, cellY + dy + 1);

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

  // Other renderers
  renderCircle(ctx, node) {
    const inputs = this.getConnectedInputs(node);

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
          this.smoothstep(radius - safeEpsilon, radius + safeEpsilon, dist);

        if (field > 0.01) {
          const intensity = Math.max(0, Math.min(1, field));
          const color = Math.floor(intensity * 255);
          ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  renderUV(ctx, node) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = x / this.size;
        const v = y / this.size;
        const r = Math.floor(u * 255);
        const g = Math.floor(v * 255);
        ctx.fillStyle = `rgb(${r}, ${g}, 128)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    ctx.strokeStyle = "#ffffff80";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.size / 2, 0);
    ctx.lineTo(this.size / 2, this.size);
    ctx.moveTo(0, this.size / 2);
    ctx.lineTo(this.size, this.size / 2);
    ctx.stroke();
  }

  renderTime(ctx, node) {
    const time = (Date.now() / 1000) % (Math.PI * 2);

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let x = 0; x < this.size; x++) {
      const t = (x / this.size) * Math.PI * 2;
      const y = this.size / 2 + Math.sin(t + time) * this.size * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const indicatorX = (time / (Math.PI * 2)) * this.size;
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(indicatorX, this.size / 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  renderExpression(ctx, node) {
    const expr = this.getParameter(node, "expr") || node.expr || "x";

    ctx.fillStyle = "#0c1821";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.beginPath();

    let hasValidPlot = false;
    let firstPoint = true;

    for (let x = 0; x < this.size; x++) {
      try {
        const mathX = (x / this.size) * 4 - 2;

        const inputs = this.getConnectedInputs(node);
        const a = inputs.a !== undefined ? inputs.a : mathX;
        const b = inputs.b !== undefined ? inputs.b : 0;

        const variables = {
          x: mathX,
          a: a,
          b: b,
          t: (Date.now() / 1000) % (Math.PI * 2),
          u_time: mathX * 10 + Date.now() / 1000,
          pi: Math.PI,
          PI: Math.PI,
        };

        const result = this.evaluateExpression(expr, variables);

        if (typeof result === "number" && isFinite(result)) {
          const variationFromBase = result - a;
          const amplifiedY = this.size / 2 - variationFromBase * 1000;
          const clampedY = Math.max(0, Math.min(this.size - 1, amplifiedY));

          if (firstPoint) {
            ctx.moveTo(x, clampedY);
            firstPoint = false;
          } else {
            ctx.lineTo(x, clampedY);
          }
          hasValidPlot = true;
        }
      } catch (e) {
        console.warn("Expression evaluation failed at x=", x, ":", e);
      }
    }

    if (hasValidPlot) {
      ctx.stroke();
    } else {
      ctx.fillStyle = "#ff4444";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("ERR", this.size / 2, this.size / 2);
    }

    ctx.fillStyle = "#10b981";
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    const displayExpr = expr.length > 10 ? expr.substring(0, 10) + "..." : expr;
    ctx.fillText(displayExpr, 2, this.size - 2);
  }

  renderSaturate(ctx, node) {
    const inputs = this.getConnectedInputs(node);
    const input = inputs.input || 0.5;
    const result = Math.max(0, Math.min(1, input));

    for (let x = 0; x < this.size; x++) {
      const testValue = (x / this.size) * 2 - 0.5;
      const saturated = Math.max(0, Math.min(1, testValue));
      const color = Math.floor(saturated * 255);
      ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
      ctx.fillRect(x, 0, 1, this.size);
    }

    const inputX = Math.floor(((input + 0.5) * this.size) / 2);
    const outputX = Math.floor(result * this.size);

    ctx.fillStyle = "#ff4444";
    ctx.fillRect(inputX, this.size - 4, 1, 4);

    ctx.fillStyle = "#44ff44";
    ctx.fillRect(outputX, 0, 1, 4);
  }

  renderOutput(ctx, node) {
    const inputs = this.getConnectedInputs(node);
    const value = inputs.input || inputs.color || inputs.value || 0;

    if (typeof value === "number") {
      const intensity = Math.max(0, Math.min(1, value));
      const color = Math.floor(intensity * 255);
      ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
      ctx.fillRect(0, 0, this.size, this.size);
    } else {
      this.renderGeneric(ctx, node);
    }
  }

  renderGeneric(ctx, node) {
    const hash = this.hashString(node.kind);
    const hue = hash % 360;

    ctx.fillStyle = `hsl(${hue}, 60%, 25%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = `hsl(${hue}, 80%, 70%)`;
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const label = node.kind.substring(0, 4);
    ctx.fillText(label, this.size / 2, this.size / 2);
  }

  renderError(ctx, node) {
    ctx.fillStyle = "#2d1b1b";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#ff4444";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ERR", this.size / 2, this.size / 2);
  }

  // Helper methods
  getCanvas(nodeId) {
    if (!this.canvasCache.has(nodeId)) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = this.size;
      this.canvasCache.set(nodeId, canvas);
    }
    return this.canvasCache.get(nodeId);
  }

  getParameter(node, name) {
    return node[name] || node.props?.[name] || 0;
  }

  toVec3(input) {
    if (Array.isArray(input)) {
      if (input.length >= 3) return [input[0], input[1], input[2]];
      if (input.length === 2) return [input[0], input[1], 0];
      if (input.length === 1) return [input[0], input[0], input[0]];
    }
    if (typeof input === "number") return [input, input, input];
    return [0, 0, 0];
  }

  smoothstep(edge0, edge1, x) {
    const t = Math.max(
      0,
      Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0)),
    );
    return t * t * (3 - 2 * t);
  }

  // Noise helpers
  simpleNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const a = this.hash2D(ix, iy);
    const b = this.hash2D(ix + 1, iy);
    const c = this.hash2D(ix, iy + 1);
    const d = this.hash2D(ix + 1, iy + 1);

    const u = fx * fx * (3.0 - 2.0 * fx);
    const v = fy * fy * (3.0 - 2.0 * fy);

    return (
      a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
    );
  }

  hash2D(x, y) {
    const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (h - Math.floor(h)) * 2 - 1;
  }

  pseudoRandom(x, y) {
    return (((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) + 1) * 0.5;
  }

  // FIXED: Node value computation with better parameter handling
  computeNodeValue(node, visited = new Set()) {
    if (visited.has(node.id)) {
      console.warn(
        `Circular dependency detected for node ${node.kind} (${node.id})`,
      );
      return 0;
    }
    visited.add(node.id);

    let result;

    switch (node.kind.toLowerCase()) {
      case "constvec3":
      case "vec3": {
        const x = this.getParameter(node, "x") || 0;
        const y = this.getParameter(node, "y") || 0;
        const z = this.getParameter(node, "z") || 0;
        result = [x, y, z];
        console.log(`computeNodeValue VEC3[${node.id}]: [${x}, ${y}, ${z}]`);
        break;
      }
      case "constfloat":
      case "float":
        result = this.getParameter(node, "value") || 0;
        break;

      case "time":
        result = (Date.now() / 1000) % 1;
        break;

      case "uv":
        result = 0.5;
        break;

      case "circle":
      case "circlefield":
        result = this.getParameter(node, "radius") || 0.5;
        break;

      case "multiply": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = inputs.a !== undefined ? inputs.a : 1;
        const b = inputs.b !== undefined ? inputs.b : 1;
        result = a * b;
        break;
      }

      case "add": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = inputs.a !== undefined ? inputs.a : 0;
        const b = inputs.b !== undefined ? inputs.b : 0;
        result = a + b;
        break;
      }

      case "divide": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = inputs.a !== undefined ? inputs.a : 1;
        const b = inputs.b !== undefined ? inputs.b : 1;
        result = b !== 0 ? a / b : 0;
        break;
      }

      case "subtract": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = inputs.a !== undefined ? inputs.a : 0;
        const b = inputs.b !== undefined ? inputs.b : 0;
        result = a - b;
        break;
      }

      case "expr": {
        const inputs = this.getConnectedInputs(node, visited);
        const expr = this.getParameter(node, "expr") || node.expr || "a";
        const a = inputs.a || 0;
        const b = inputs.b || 0;
        const variables = {
          a: a,
          b: b,
          t: (Date.now() / 1000) % (Math.PI * 2),
          u_time: Date.now() / 1000,
          pi: Math.PI,
          PI: Math.PI,
        };
        result = this.evaluateExpression(expr, variables);
        break;
      }

      case "saturate": {
        const inputs = this.getConnectedInputs(node, visited);
        const input = inputs.input || inputs.a || 0;
        result = Math.max(0, Math.min(1, input));
        break;
      }

      case "dot": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = this.toVec3(inputs.a || [1, 0, 0]);
        const b = this.toVec3(inputs.b || [0, 1, 0]);
        result = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        break;
      }

      case "cross": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = this.toVec3(inputs.a || [1, 0, 0]);
        const b = this.toVec3(inputs.b || [0, 1, 0]);
        result = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        break;
      }

      case "normalize": {
        const inputs = this.getConnectedInputs(node, visited);
        const vec = this.toVec3(inputs.vec || inputs.a || [1, 0, 0]);
        const length = Math.sqrt(
          vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2],
        );
        if (length > 1e-6) {
          result = [vec[0] / length, vec[1] / length, vec[2] / length];
        } else {
          result = [0, 0, 0];
        }
        break;
      }

      case "length": {
        const inputs = this.getConnectedInputs(node, visited);
        const vec = this.toVec3(inputs.vec || inputs.a || [1, 1, 0]);
        result = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]);
        break;
      }

      case "distance": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = this.toVec3(inputs.a || [0, 0, 0]);
        const b = this.toVec3(inputs.b || [0, 0, 0]);
        const diff = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        result = Math.sqrt(
          diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2],
        );
        break;
      }

      case "reflect": {
        const inputs = this.getConnectedInputs(node, visited);
        const incident = this.toVec3(inputs.i || inputs.a || [1, -1, 0]);
        const normal = this.toVec3(inputs.n || inputs.b || [0, 1, 0]);

        const nLength = Math.sqrt(
          normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2],
        );
        const n =
          nLength > 1e-6
            ? [normal[0] / nLength, normal[1] / nLength, normal[2] / nLength]
            : [0, 1, 0];

        const dotNI =
          n[0] * incident[0] + n[1] * incident[1] + n[2] * incident[2];
        result = [
          incident[0] - 2 * dotNI * n[0],
          incident[1] - 2 * dotNI * n[1],
          incident[2] - 2 * dotNI * n[2],
        ];
        break;
      }

      case "refract": {
        const inputs = this.getConnectedInputs(node, visited);
        const incident = this.toVec3(inputs.i || inputs.a || [1, -1, 0]);
        const normal = this.toVec3(inputs.n || inputs.b || [0, 1, 0]);
        const eta = inputs.eta || inputs.c || 1.5;

        const nLength = Math.sqrt(
          normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2],
        );
        const n =
          nLength > 1e-6
            ? [normal[0] / nLength, normal[1] / nLength, normal[2] / nLength]
            : [0, 1, 0];

        const iLength = Math.sqrt(
          incident[0] * incident[0] +
            incident[1] * incident[1] +
            incident[2] * incident[2],
        );
        const i =
          iLength > 1e-6
            ? [
                incident[0] / iLength,
                incident[1] / iLength,
                incident[2] / iLength,
              ]
            : [0, 0, 0];

        const dotNI = n[0] * i[0] + n[1] * i[1] + n[2] * i[2];
        const k = 1.0 - eta * eta * (1.0 - dotNI * dotNI);

        if (k < 0.0) {
          result = [0, 0, 0];
        } else {
          const sqrtK = Math.sqrt(k);
          result = [
            eta * i[0] - (eta * dotNI + sqrtK) * n[0],
            eta * i[1] - (eta * dotNI + sqrtK) * n[1],
            eta * i[2] - (eta * dotNI + sqrtK) * n[2],
          ];
        }
        break;
      }

      default:
        result = 0;
    }

    visited.delete(node.id);
    return result;
  }

  // FIXED: Better connection handling
  getConnectedInputs(node, visited = new Set()) {
    const inputs = {};

    if (!this.editor.graph?.connections) return inputs;

    for (const conn of this.editor.graph.connections) {
      if (conn.to.nodeId === node.id) {
        const sourceNode = this.editor.graph.nodes.find(
          (n) => n.id === conn.from.nodeId,
        );
        if (sourceNode) {
          const value = this.computeNodeValue(sourceNode, visited);
          const pinIndex = conn.to.pin;

          let inputName;
          if (pinIndex === 0) {
            inputName = "a";
          } else if (pinIndex === 1) {
            inputName = "b";
          } else if (pinIndex === 2) {
            inputName = "c";
          } else {
            inputName = `input${pinIndex}`;
          }

          inputs[inputName] = value;

          // Add common aliases
          if (pinIndex === 0) {
            inputs.input = value;
            inputs.value = value;
            inputs.vec = value;
            inputs.i = value;
          }
          if (pinIndex === 1) {
            inputs.n = value;
          }
          if (pinIndex === 2) {
            inputs.eta = value;
          }
        }
      }
    }

    return inputs;
  }

  evaluateExpression(expr, vars) {
    try {
      let processed = expr;
      for (const [name, value] of Object.entries(vars)) {
        processed = processed.replace(new RegExp(`\\b${name}\\b`, "g"), value);
      }
      processed = processed.replace(/sin/g, "Math.sin");
      processed = processed.replace(/cos/g, "Math.cos");
      processed = processed.replace(/pi/g, "Math.PI");

      return eval(processed);
    } catch (e) {
      return 0;
    }
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
  }

  clearCache() {
    this.canvasCache.clear();
  }
}

// Integration code for Editor.js
export class PreviewIntegration {
  constructor(editor) {
    this.editor = editor;
    this.previewSystem = new PreviewSystem(editor);

    setTimeout(() => {
      if (this.editor.isPreviewEnabled) {
        this.updateAllPreviews();
      }
    }, 100);

    setInterval(() => {
      if (this.editor.isPreviewEnabled) {
        this.updateTimeNodes();
      }
    }, 100);
  }

  updateAllPreviews() {
    this.previewSystem.updateAllPreviews();
  }

  generateNodePreview(node) {
    this.previewSystem.generateNodePreview(node);
  }

  updateTimeNodes() {
    if (!this.editor.graph?.nodes) return;

    const timeNodes = this.editor.graph.nodes.filter(
      (n) => n.kind.toLowerCase() === "time",
    );

    if (timeNodes.length > 0) {
      timeNodes.forEach((node) => this.previewSystem.generateNodePreview(node));
      this.editor.draw();
    }
  }

  onParameterChange(node) {
    this.generateNodePreview(node);
    this.updateDependentNodes(node);
  }

  updateDependentNodes(changedNode) {
    if (!this.editor.graph?.connections) return;

    const dependents = this.editor.graph.connections
      .filter((conn) => conn.from.nodeId === changedNode.id)
      .map((conn) => conn.to.nodeId);

    dependents.forEach((nodeId) => {
      const node = this.editor.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.generateNodePreview(node);
      }
    });

    this.editor.draw();
  }
}
