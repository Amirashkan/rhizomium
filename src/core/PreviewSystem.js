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
    
    // Create integration layer
    this.integration = new PreviewIntegration(editor, this);
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

  // Expose subsystem APIs
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