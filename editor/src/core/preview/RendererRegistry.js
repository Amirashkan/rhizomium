// src/core/preview/RendererRegistry.js

export class RendererRegistry {
  constructor() {
    this.renderers = new Map();
  }

  register(nodeType, renderer) {
    this.renderers.set(nodeType.toLowerCase(), renderer);
  }

  registerMultiple(nodeTypesToRenderer) {
    Object.entries(nodeTypesToRenderer).forEach(([nodeType, renderer]) => {
      this.register(nodeType, renderer);
    });
  }

  getRenderer(nodeType) {
    return this.renderers.get(nodeType.toLowerCase());
  }

  hasRenderer(nodeType) {
    return this.renderers.has(nodeType.toLowerCase());
  }

  getRegisteredTypes() {
    return Array.from(this.renderers.keys());
  }

  unregister(nodeType) {
    this.renderers.delete(nodeType.toLowerCase());
  }

  clear() {
    this.renderers.clear();
  }
}