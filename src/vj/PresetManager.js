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

    (this.editor.graph?.nodes || []).forEach(node => {
      const params = this.readNodeParameters(node);
      if (Object.keys(params).length > 0) {
        parameterState[String(node.id)] = {
          kind: node.kind,
          params
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
   * Read a node's parameters the way the rest of the editor stores them.
   *
   * A parameter does not always live in node.params: scalar nodes keep theirs in
   * node.value, expression nodes in node.expr, and older graphs in node.props.
   * Capturing node.params alone skipped those nodes entirely, which is why a
   * preset could look captured and then change nothing on apply.
   */
  readNodeParameters(node) {
    const params = {};

    if (node.props && typeof node.props === 'object') {
      Object.assign(params, node.props);
    }
    if (node.params && typeof node.params === 'object') {
      Object.assign(params, node.params);
    }
    if (typeof node.value !== 'undefined') {
      params.value = node.value;
    }
    if (typeof node.expr !== 'undefined') {
      params.expr = node.expr;
    }

    // Deep clone so later edits to the graph can't mutate the stored preset.
    return JSON.parse(JSON.stringify(params));
  }

  /**
   * Write one parameter back, mirroring ParameterValueManager's storage rules so
   * codegen and the parameter panel both read the value we just set.
   */
  writeNodeParameter(node, paramName, value) {
    if (paramName === 'value') {
      node.value = value;
      return;
    }
    if (paramName === 'expr') {
      node.expr = value;
      return;
    }

    if (!node.params) node.params = {};
    node.params[paramName] = value;

    // props is the legacy mirror; several readers still fall back to it.
    if (node.props && typeof node.props === 'object') {
      node.props[paramName] = value;
    }
  }

  /**
   * Find the node a captured entry belongs to. Preset keys are strings because
   * they came from an object, while node ids may be numbers - compare loosely so
   * the lookup doesn't silently miss.
   */
  findNode(nodeId, kind) {
    const node = (this.editor.graph?.nodes || []).find(n => String(n.id) === String(nodeId));
    if (!node) return null;
    if (kind && node.kind !== kind) return null;
    return node;
  }

  /**
   * Push the parameter writes through to the render.
   *
   * The old code called editor.onGraphChanged(), which no editor has ever
   * defined, so applying a preset updated the data and nothing else - no
   * recompile, no visible change.
   */
  commitParameterChanges(touchedNodes = []) {
    touchedNodes.forEach(node => {
      try {
        this.editor.updateNodePreview?.(node);
      } catch {
        // A preview refresh failing must not stop the shader rebuild below.
      }
    });

    if (typeof this.editor.onChange === 'function') {
      this.editor.onChange('VJ Preset');
    } else if (typeof window !== 'undefined' && typeof window.rebuild === 'function') {
      window.rebuild();
    }

    // Keep the parameter panel showing the values that are now live.
    this.editor.paramPanel?.refreshParameterDisplays?.();
    this.editor.markDirty?.('vj-preset', 'nodes');
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
    const touched = [];

    // Apply parameters to matching nodes
    Object.entries(parameterState || {}).forEach(([nodeId, nodeState]) => {
      const node = this.findNode(nodeId, nodeState.kind);
      if (!node) return;

      Object.entries(nodeState.params || {}).forEach(([paramName, paramValue]) => {
        this.writeNodeParameter(node, paramName, paramValue);
      });
      touched.push(node);
    });

    // Trigger recompile
    this.commitParameterChanges(touched);
  }

  /**
   * Interpolate to preset over time
   */
  async interpolateToPreset(preset, duration) {
    const { parameterState } = preset;
    const startTime = performance.now();

    // Resolve every target node once, up front: the animation runs per frame and
    // re-scanning the graph each time is both slow and a chance to disagree with
    // the start values we snapshot here.
    const targets = [];
    Object.entries(parameterState || {}).forEach(([nodeId, nodeState]) => {
      const node = this.findNode(nodeId, nodeState.kind);
      if (!node) return;

      targets.push({
        node,
        params: nodeState.params || {},
        startParams: this.readNodeParameters(node)
      });
    });

    if (targets.length === 0) return;

    // Animation loop
    return new Promise(resolve => {
      const animate = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        const t = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
        const eased = this.easeInOutCubic(t);

        // Interpolate each parameter
        targets.forEach(({ node, params, startParams }) => {
          Object.entries(params).forEach(([paramName, endValue]) => {
            const startValue = startParams[paramName];

            // Interpolate based on type
            if (typeof startValue === 'number' && typeof endValue === 'number') {
              this.writeNodeParameter(node, paramName, startValue + (endValue - startValue) * eased);
            } else if (Array.isArray(startValue) && Array.isArray(endValue)) {
              this.writeNodeParameter(node, paramName, startValue.map((v, i) =>
                typeof v === 'number' && typeof endValue[i] === 'number'
                  ? v + (endValue[i] - v) * eased
                  : endValue[i]
              ));
            } else if (t >= 0.5) {
              // Non-interpolatable types: switch at halfway point
              this.writeNodeParameter(node, paramName, endValue);
            }
          });
        });

        // Trigger recompile
        this.commitParameterChanges(targets.map(target => target.node));

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
    } catch {

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
