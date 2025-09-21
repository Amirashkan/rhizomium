// src/core/preview/PreviewIntegration.js

export class PreviewIntegration {
  constructor(editor, previewSystem) {
    this.editor = editor;
    this.previewSystem = previewSystem;

    // Initialize with delay to ensure editor is ready
    setTimeout(() => {
      if (this.editor.isPreviewEnabled) {
        this.updateAllPreviews();
      }
    }, 100);

    // Set up time-based updates for animated nodes
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
      (n) => n.kind.toLowerCase() === "time"
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

  onNodeAdded(node) {
    this.generateNodePreview(node);
  }

  onNodeRemoved(nodeId) {
    this.previewSystem.canvasManager.removeCanvas(nodeId);
  }

  onGraphCleared() {
    this.previewSystem.clearCache();
  }

  // Expose preview system methods for backward compatibility
  renderTexture2D(node, size) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    
    const textureRenderer = this.previewSystem.rendererRegistry.getRenderer('texture2d');
    if (textureRenderer) {
      textureRenderer(ctx, node);
    }
    
    return canvas;
  }
}