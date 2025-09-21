// src/core/PreviewSystem.js

import { CanvasManager } from './preview/CanvasManager.js';
import { NodeValueComputer } from './preview/NodeValueComputer.js';
import { RendererRegistry } from './preview/RendererRegistry.js';
import { PreviewIntegration } from './preview/PreviewIntegration.js';

// Import all renderers
import { BasicRenderers } from './preview/renderers/BasicRenderers.js';
import { MathRenderers } from './preview/renderers/MathRenderers.js';
import { VectorRenderers } from './preview/renderers/VectorRenderers.js';
import { NoiseRenderers } from './preview/renderers/NoiseRenderers.js';
import { TextureRenderers } from './preview/renderers/TextureRenderers.js';
import { UtilityRenderers } from './preview/renderers/UtilityRenderers.js';

export class PreviewSystem {
  constructor(editor) {
    this.editor = editor;
    this.size = 48;
    
    // Initialize subsystems
    this.canvasManager = new CanvasManager(this.size);
    this.nodeValueComputer = new NodeValueComputer(editor);
    this.rendererRegistry = new RendererRegistry();
    
    // Register all renderers
    this._registerRenderers();
    
    // Don't create integration here - let it be created externally
    this.integration = null;
  }

  // Method to set the integration after construction
  setIntegration(integration) {
    this.integration = integration;
  }

  // Static factory method for proper initialization
  static create(editor) {
    const previewSystem = new PreviewSystem(editor);
    const integration = new PreviewIntegration(editor, previewSystem);
    previewSystem.setIntegration(integration);
    return previewSystem;
  }

  _registerRenderers() {
    const rendererGroups = [
      BasicRenderers,
      MathRenderers, 
      VectorRenderers,
      NoiseRenderers,
      TextureRenderers,
      UtilityRenderers
    ];

    rendererGroups.forEach(RendererGroup => {
      const renderers = new RendererGroup(this);
      renderers.register(this.rendererRegistry);
    });
  }

  generateNodePreview(node) {
    console.log("Generating preview for:", node.kind, node.kind.toLowerCase());

    if (!this.editor.isPreviewEnabled) {
      node.__thumb = null;
      return;
    }

    try {
      const canvas = this.canvasManager.getCanvas(node.id);
      const ctx = canvas.getContext("2d");

      // Clear canvas
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, this.size, this.size);

      // Get and execute renderer
      const renderer = this.rendererRegistry.getRenderer(node.kind.toLowerCase());
      if (renderer) {
        renderer(ctx, node);
      } else {
        this._renderGeneric(ctx, node);
      }

      node.__thumb = canvas;
    } catch (error) {
      console.warn("Preview failed:", node.kind, error);
      const canvas = this.canvasManager.getCanvas(node.id);
      const ctx = canvas.getContext("2d");
      this._renderError(ctx, node);
      node.__thumb = canvas;
    }
  }

  updateAllPreviews() {
    if (!this.editor.graph?.nodes) return;

    this.editor.graph.nodes.forEach((node) => {
      this.generateNodePreview(node);
    });

    this.editor.draw();
  }

  // Texture2D renderer method for backward compatibility
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

  _renderGeneric(ctx, node) {
    const hash = this._hashString(node.kind);
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

  _renderError(ctx, node) {
    ctx.fillStyle = "#2d1b1b";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#ff4444";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ERR", this.size / 2, this.size / 2);
  }

  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
  }

  clearCache() {
    this.canvasManager.clearCache();
  }

  // Expose subsystem APIs for backward compatibility
  getParameter(node, name) {
    return node[name] || node.props?.[name] || 0;
  }

  computeNodeValue(node, visited = new Set()) {
    return this.nodeValueComputer.computeNodeValue(node, visited);
  }

  getConnectedInputs(node, visited = new Set()) {
    return this.nodeValueComputer.getConnectedInputs(node, visited);
  }
}

// Export the integration class for compatibility
export { PreviewIntegration };