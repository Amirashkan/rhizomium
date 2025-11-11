/**
 * PresetManager.js
 *
 * Manages parameter presets within a scene for quick parameter state switching.
 */

export class PresetManager {
  constructor(editor) {
    this.editor = editor;

    // Presets storage: Map<presetId, preset>
    this.presets = new Map();
    this.activePresetId = null;
    this.presetOrder = [];

  }

  /**
   * Capture current parameter state as a preset
   * @param {string} name - Name for the preset
   * @returns {Object} The created preset
   */
  capturePreset(name) {
    const presetId = `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Capture all node parameters
    const parameterState = {};

    this.editor.graph.nodes.forEach(node => {
      if (node.params && Object.keys(node.params).length > 0) {
        parameterState[node.id] = {
          kind: node.kind,
          params: JSON.parse(JSON.stringify(node.params)) // Deep clone
        };
      }
    });

    const preset = {
      id: presetId,
      name: name || `Preset ${this.presets.size + 1}`,
      parameterState,
      capturedAt: Date.now(),
      lastUsed: null
    };

    this.presets.set(presetId, preset);
    if (!this.presetOrder.includes(presetId)) {
      this.presetOrder.push(presetId);
    }

    return preset;
  }

  /**
   * Apply a preset to the current scene
   * @param {string} presetId - ID of preset to apply
   * @param {number} transitionTime - Time in seconds to interpolate (0 = instant)
   */
  async applyPreset(presetId, transitionTime = 0) {
    const preset = this.presets.get(presetId);
    if (!preset) {

      return false;
    }

    if (transitionTime > 0) {
      // Smooth transition using interpolation
      await this.interpolateToPreset(preset, transitionTime);
    } else {
      // Instant application
      this.applyPresetInstant(preset);
    }

    this.activePresetId = presetId;
    preset.lastUsed = Date.now();

    return true;
  }

  /**
   * Apply preset instantly
   */
  applyPresetInstant(preset) {
    const { parameterState } = preset;

    // Apply parameters to matching nodes
    Object.entries(parameterState).forEach(([nodeId, nodeState]) => {
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);
      if (node && node.kind === nodeState.kind) {
        // Apply each parameter
        Object.entries(nodeState.params).forEach(([paramName, paramValue]) => {
          if (node.params.hasOwnProperty(paramName)) {
            node.params[paramName] = paramValue;
          }
        });
      }
    });

    // Trigger recompile
    if (this.editor.onGraphChanged) {
      this.editor.onGraphChanged();
    }
  }

  /**
   * Interpolate to preset over time
   */
  async interpolateToPreset(preset, duration) {
    const { parameterState } = preset;
    const startTime = performance.now();
    const startState = {};

    // Capture start values
    Object.entries(parameterState).forEach(([nodeId, nodeState]) => {
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);
      if (node && node.kind === nodeState.kind) {
        startState[nodeId] = {
          kind: node.kind,
          params: JSON.parse(JSON.stringify(node.params))
        };
      }
    });

    // Animation loop
    return new Promise(resolve => {
      const animate = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        const t = Math.min(elapsed / duration, 1);
        const eased = this.easeInOutCubic(t);

        // Interpolate each parameter
        Object.entries(parameterState).forEach(([nodeId, nodeState]) => {
          const node = this.editor.graph.nodes.find(n => n.id === nodeId);
          const start = startState[nodeId];

          if (node && start) {
            Object.entries(nodeState.params).forEach(([paramName, endValue]) => {
              const startValue = start.params[paramName];

              // Interpolate based on type
              if (typeof startValue === 'number' && typeof endValue === 'number') {
                node.params[paramName] = startValue + (endValue - startValue) * eased;
              } else if (Array.isArray(startValue) && Array.isArray(endValue)) {
                node.params[paramName] = startValue.map((v, i) =>
                  v + (endValue[i] - v) * eased
                );
              } else {
                // Non-interpolatable types: switch at halfway point
                if (t >= 0.5) {
                  node.params[paramName] = endValue;
                }
              }
            });
          }
        });

        // Trigger recompile
        if (this.editor.onGraphChanged) {
          this.editor.onGraphChanged();
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Easing function
   */
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * Delete a preset
   */
  deletePreset(presetId) {
    if (!this.presets.has(presetId)) return false;

    this.presets.delete(presetId);
    this.presetOrder = this.presetOrder.filter(id => id !== presetId);

    if (this.activePresetId === presetId) {
      this.activePresetId = null;
    }

    return true;
  }

  /**
   * Get all presets
   */
  getAllPresets() {
    return this.presetOrder.map(id => this.presets.get(id)).filter(Boolean);
  }

  /**
   * Rename preset
   */
  renamePreset(presetId, newName) {
    const preset = this.presets.get(presetId);
    if (!preset) return false;

    preset.name = newName;
    return true;
  }

  /**
   * Reorder presets
   */
  reorderPresets(newOrder) {
    const valid = newOrder.every(id => this.presets.has(id));
    if (!valid) return false;

    this.presetOrder = [...newOrder];
    return true;
  }

  /**
   * Export presets
   */
  exportPresets() {
    return {
      version: 1,
      presets: this.getAllPresets(),
      presetOrder: this.presetOrder
    };
  }

  /**
   * Import presets
   */
  importPresets(data) {
    if (!data || !data.presets) return false;

    try {
      this.presets.clear();
      this.presetOrder = [];

      data.presets.forEach(preset => {
        this.presets.set(preset.id, preset);
        this.presetOrder.push(preset.id);
      });

      if (data.presetOrder) {
        this.presetOrder = data.presetOrder;
      }

      return true;
    } catch (error) {

      return false;
    }
  }

  /**
   * Clear all presets
   */
  clear() {
    this.presets.clear();
    this.presetOrder = [];
    this.activePresetId = null;
  }
}
