// src/core/preview/renderers/UtilityRenderers.js

export class UtilityRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    // This class can be extended for additional utility renderers
    // Currently empty but provides structure for future additions
  }
}