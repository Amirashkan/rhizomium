// src/core/preview/PreviewIntegration.js

export class PreviewIntegration {
  constructor(editor, previewSystem) {
    this.editor = editor;
    this.previewSystem = previewSystem;
    this.timeUpdateInterval = null;

    // Initialize with delay to ensure everything is ready
    setTimeout(() => {
      this.initialize();
    }, 100);
  }

  initialize() {
    if (this.editor.isPreviewEnabled && this.previewSystem) {
      this.updateAllPreviews();
    }

    // Set up time-based updates for animated nodes
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
    }
    
    this.timeUpdateInterval = setInterval(() => {
      if (this.editor.isPreviewEnabled && this.previewSystem) {
        this.updateTimeNodes();
      }
    }, 100);
  }

  updateAllPreviews() {
    if (!this.previewSystem) {
      console.warn("PreviewSystem not available for updateAllPreviews");
      return;
    }
    this.previewSystem.updateAllPreviews();
  }

  generateNodePreview(node) {
    if (!this.previewSystem) {
      console.warn("PreviewSystem not available for generateNodePreview");
      return;
    }
    this.previewSystem.generateNodePreview(node);
  }

  updateTimeNodes() {
    if (!this.editor.graph?.nodes || !this.previewSystem) return;

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
    if (!this.previewSystem) {
      console.warn("PreviewSystem not available for onGraphCleared");
      return;
    }
    this.previewSystem.clearCache();
  }

  // Cleanup method
  destroy() {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }
  }

  // Expose preview system methods for backward compatibility
  renderTexture2D(node, size) {
    if (!this.previewSystem) {
      console.warn("PreviewSystem not available for renderTexture2D");
      return null;
    }

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