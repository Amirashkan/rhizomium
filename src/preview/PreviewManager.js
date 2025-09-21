// src/preview/PreviewManager.js - Safe version
export class PreviewManager {
  constructor() {
    this.renderers = new Map();
    this.cache = new Map();
    this.enabled = true;

    // Register default renderers safely
    this.registerDefaultRenderers();
  }

  async registerDefaultRenderers() {
    // Try to load preview renderers, but don't fail if they don't exist
    const rendererFiles = [
      "./renderers/MathPreviews.js",
      "./renderers/SystemPreviews.js",
      "./renderers/FieldPreviews.js",
      "./renderers/NoisePreviews.js",
      "./renderers/TexturePreviews.js",
    ];

    for (const file of rendererFiles) {
      try {
        const module = await import(file);
        if (module.registerRenderers) {
          module.registerRenderers(this);
          console.log(`✅ Loaded preview renderers from ${file}`);
        }
      } catch (error) {
        console.warn(
          `⚠️ Could not load preview renderers from ${file}:`,
          error.message,
        );
        // Continue without this renderer - not critical
      }
    }

    // Register a basic fallback renderer
    this.registerRenderer("default", (node, context) => {
      return `Preview for ${node.type} node`;
    });

    console.log(
      `PreviewManager initialized with ${this.renderers.size} renderers`,
    );
  }

  registerRenderer(nodeType, renderFunction) {
    this.renderers.set(nodeType, renderFunction);
  }

  invalidateCache(nodeId = null) {
    if (nodeId) {
      this.cache.delete(nodeId);
    } else {
      this.cache.clear();
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.cache.clear();
    }
  }

  async generatePreview(node, context = {}) {
    if (!this.enabled) return null;

    const cacheKey = `${node.id}_${JSON.stringify(node.props || {})}_${node.lastModified || 0}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const renderer =
        this.renderers.get(node.type) || this.renderers.get("default");

      if (!renderer) {
        console.warn(`No preview renderer found for node type: ${node.type}`);
        return null;
      }

      const result = await renderer(node, context);
      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`Error generating preview for node ${node.id}:`, error);
      return null;
    }
  }

  clearCache() {
    this.cache.clear();
  }

  getStats() {
    return {
      renderersCount: this.renderers.size,
      cacheSize: this.cache.size,
      enabled: this.enabled,
    };
  }
}
