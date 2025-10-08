// src/core/preview/CanvasManager.js

export class CanvasManager {
  constructor(size) {
    this.canvasCache = new Map();
    this.size = size;
  }

  getCanvas(nodeId) {
    if (!this.canvasCache.has(nodeId)) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = this.size;
      this.canvasCache.set(nodeId, canvas);
    }
    return this.canvasCache.get(nodeId);
  }

  clearCache() {
    this.canvasCache.clear();
  }

  removeCanvas(nodeId) {
    this.canvasCache.delete(nodeId);
  }

  getCacheSize() {
    return this.canvasCache.size;
  }
}