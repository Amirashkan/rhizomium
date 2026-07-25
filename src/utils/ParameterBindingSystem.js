// src/utils/ParameterBindingSystem.js
import { expressionSystem } from './ParameterExpressionSystem.js';

export class ParameterBindingSystem {
  constructor(graph, eventSystem, undoManager) {
    this.graph = graph;
    this.eventSystem = eventSystem;
    this.undoManager = undoManager;

    // Expression system used to evaluate per-binding transform expressions.
    this.expressionSystem = expressionSystem;

    // Map of parameter bindings: sourceId -> Set of bound parameters
    this.bindings = new Map();

    // Reverse map for quick lookup: boundId -> source parameter
    this.boundToSource = new Map();

    // Optional transform expression per bound target: targetKey -> "=bound * 2".
    // A bound parameter mirrors its source value; the transform (when present) post-processes
    // that driven value, with the live source value exposed to the expression as `bound`/`self`.
    this.transforms = new Map();

    // Parameter clipboard for copy/paste operations
    this.clipboard = null;

    // Binding visualization state
    this.showBindings = false;

    // MIDI preview update throttling for bound parameters
    this.midiBindingUpdateTimer = null;
    this.midiBindingUpdateDelay = 500; // ms
    this.pendingMidiBindingUpdates = new Set();

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Listen for parameter changes to update bound parameters
    this.eventSystem.on('PARAMETER_CHANGED', (data) => {
      this.updateBoundParameters(data.node, data.parameterName, data.newValue, data.source);
    });

    // Listen for keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c' && e.shiftKey) {
          e.preventDefault();
          this.copyParameterAsReference();
        } else if (e.key === 'v' && e.shiftKey) {
          e.preventDefault();
          this.pasteParameterReference();
        }
      }
    });
  }

  // Copy parameter reference to clipboard
  copyParameterAsReference() {
    const selectedNode = this.getSelectedNode();
    const selectedParam = this.getSelectedParameter();
    
    if (!selectedNode || !selectedParam) {
      return false;
    }

    this.clipboard = {
      nodeId: selectedNode.id,
      parameterName: selectedParam.name,
      nodeKind: selectedNode.kind,
      timestamp: Date.now()
    };

    // Visual feedback
    this.showCopyFeedback(selectedNode, selectedParam);
    
    return true;
  }

  // Paste parameter reference to create binding
  pasteParameterReference() {
    if (!this.clipboard) {
      return false;
    }

    const targetNode = this.getSelectedNode();
    const targetParam = this.getSelectedParameter();
    
    if (!targetNode || !targetParam) {
      return false;
    }

    // Don't bind to self
    if (targetNode.id === this.clipboard.nodeId && 
        targetParam.name === this.clipboard.parameterName) {
      return false;
    }

    return this.createBinding(
      this.clipboard.nodeId,
      this.clipboard.parameterName,
      targetNode.id,
      targetParam.name
    );
  }

  // Create a binding between source and target parameters
  createBinding(
    sourceNodeId,
    sourceParamName,
    targetNodeId,
    targetParamName,
    options = {},
  ) {
    const recordUndo = options.recordUndo !== false;

    const sourceNode = this.graph.nodes.find(n => n.id === sourceNodeId);
    const targetNode = this.graph.nodes.find(n => n.id === targetNodeId);

    if (!sourceNode || !targetNode) {

      return false;
    }

    // Check for circular dependencies
    if (this.wouldCreateCircularDependency(sourceNodeId, sourceParamName, targetNodeId, targetParamName)) {

      return false;
    }

    const sourceKey = `${sourceNodeId}.${sourceParamName}`;
    const targetKey = `${targetNodeId}.${targetParamName}`;
    const previousBinding = this.boundToSource.get(targetKey);

    if (
      previousBinding &&
      previousBinding.nodeId === sourceNodeId &&
      previousBinding.parameterName === sourceParamName
    ) {
      return false;
    }

    const previousBindingSnapshot = previousBinding
      ? {
          sourceNodeId: previousBinding.nodeId,
          sourceParamName: previousBinding.parameterName,
        }
      : null;

    const previousValue = this.getParameterValue(targetNode, targetParamName);

    // Remove existing binding if target is already bound
    this.removeBindingForTarget(targetNodeId, targetParamName, {
      recordUndo: false,
    });

    // Add to bindings map
    if (!this.bindings.has(sourceKey)) {
      this.bindings.set(sourceKey, new Set());
    }
    
    this.bindings.get(sourceKey).add({
      nodeId: targetNodeId,
      parameterName: targetParamName
    });

    // Add to reverse map
    this.boundToSource.set(targetKey, {
      nodeId: sourceNodeId,
      parameterName: sourceParamName
    });

    // Set initial value. A static source yields a number; an expression source (=audioEnvelope,
    // =time, ...) yields a composed expression so the target tracks it live instead of freezing.
    const initialValue = this._composeTargetValue(targetNode, targetParamName, sourceNode, sourceParamName);
    this.setParameterValue(targetNode, targetParamName, initialValue);
    this._requestRebuildIfExpression(initialValue);

    // Record for undo
    if (recordUndo && this.undoManager) {
      this.undoManager.recordAction({
        type: 'CREATE_BINDING',
        sourceNodeId,
        sourceParamName,
        targetNodeId,
        targetParamName,
        oldValue: previousValue,
        previousBinding: previousBindingSnapshot,
      });
    }

    // Visual feedback
    this.showBindingCreatedFeedback(sourceNode, sourceParamName, targetNode, targetParamName);

    // Emit event
    this.eventSystem.emit('BINDING_CREATED', {
      sourceNodeId,
      sourceParamName,
      targetNodeId,
      targetParamName
    });

    return true;
  }

  // Remove a specific binding
  removeBinding(
    sourceNodeId,
    sourceParamName,
    targetNodeId,
    targetParamName,
    options = {},
  ) {
    const recordUndo = options.recordUndo !== false;

    const sourceKey = `${sourceNodeId}.${sourceParamName}`;
    const targetKey = `${targetNodeId}.${targetParamName}`;
    const targetNode = this.graph.nodes.find(n => n.id === targetNodeId);
    const currentValue = targetNode
      ? this.getParameterValue(targetNode, targetParamName)
      : undefined;

    // Remove from bindings map
    if (this.bindings.has(sourceKey)) {
      const boundParams = this.bindings.get(sourceKey);
      boundParams.forEach(bound => {
        if (bound.nodeId === targetNodeId && bound.parameterName === targetParamName) {
          boundParams.delete(bound);
        }
      });
      
      if (boundParams.size === 0) {
        this.bindings.delete(sourceKey);
      }
    }

    // Remove from reverse map
    this.boundToSource.delete(targetKey);

    // Drop any transform expression attached to this binding
    this.transforms.delete(targetKey);

    // Emit event
    this.eventSystem.emit('BINDING_REMOVED', {
      sourceNodeId,
      sourceParamName,
      targetNodeId,
      targetParamName
    });

    if (recordUndo && this.undoManager) {
      this.undoManager.recordAction({
        type: 'REMOVE_BINDING',
        sourceNodeId,
        sourceParamName,
        targetNodeId,
        targetParamName,
        detachedValue: currentValue,
      });
    }

    return true;
  }

  // Remove all bindings for a target parameter
  removeBindingForTarget(targetNodeId, targetParamName, options = {}) {
    const targetKey = `${targetNodeId}.${targetParamName}`;
    const source = this.boundToSource.get(targetKey);
    
    if (source) {
      this.removeBinding(
        source.nodeId,
        source.parameterName,
        targetNodeId,
        targetParamName,
        { recordUndo: options.recordUndo !== false ? options.recordUndo : false },
      );
    }
  }

  // Remove all bindings for a source parameter
  removeBindingsForSource(sourceNodeId, sourceParamName, options = {}) {
    const sourceKey = `${sourceNodeId}.${sourceParamName}`;
    const boundParams = this.bindings.get(sourceKey);
    
    if (boundParams) {
      const toRemove = Array.from(boundParams);
      toRemove.forEach(bound => {
        this.removeBinding(
          sourceNodeId,
          sourceParamName,
          bound.nodeId,
          bound.parameterName,
          { recordUndo: options.recordUndo !== false ? options.recordUndo : false },
        );
      });
    }
  }

  // Update all parameters bound to a source parameter
  updateBoundParameters(sourceNode, sourceParamName, newValue, source) {
    const sourceKey = `${sourceNode.id}.${sourceParamName}`;
    const boundParams = this.bindings.get(sourceKey);

    if (!boundParams || boundParams.size === 0) return;

    boundParams.forEach(bound => {
      const targetNode = this.graph.nodes.find(n => n.id === bound.nodeId);
      if (targetNode) {
        // Compose the target value from the source's current raw value + this binding's transform:
        // a number for a static source, or a live expression when the source is itself an
        // expression (so it keeps animating instead of freezing on the last numeric snapshot).
        const finalValue = this._composeTargetValue(
          targetNode, bound.parameterName, sourceNode, sourceParamName,
        );
        this.setParameterValueDirect(targetNode, bound.parameterName, finalValue);
        this._requestRebuildIfExpression(finalValue);

        // For MIDI sources, skip expensive preview updates during active control
        if (source === 'midi') {
          // Store node for later preview update
          this.pendingMidiBindingUpdates.add(targetNode);

          // Debounce preview update
          if (this.midiBindingUpdateTimer) {
            clearTimeout(this.midiBindingUpdateTimer);
          }
          this.midiBindingUpdateTimer = setTimeout(() => {
            this.processPendingMidiBindingUpdates();
          }, this.midiBindingUpdateDelay);
        } else {
          // For non-MIDI sources, update preview immediately
          this.updateNodePreview(targetNode);
        }
      }
    });
  }

  processPendingMidiBindingUpdates() {
    // Update previews for all bound nodes after MIDI stops
    for (const targetNode of this.pendingMidiBindingUpdates) {
      this.updateNodePreview(targetNode);
    }
    this.pendingMidiBindingUpdates.clear();
    this.midiBindingUpdateTimer = null;
  }

  // Public method to flush pending MIDI binding updates immediately (e.g., on node deselect)
  flushPendingMidiUpdates() {
    if (this.midiBindingUpdateTimer) {
      clearTimeout(this.midiBindingUpdateTimer);
      this.midiBindingUpdateTimer = null;
      this.processPendingMidiBindingUpdates();
    }
  }

  // Normalize a transform expression: trim, drop empties, ensure the leading '='.
  _normalizeTransform(expression) {
    if (typeof expression !== 'string') return '';
    const trimmed = expression.trim();
    if (!trimmed || trimmed === '=') return '';
    return trimmed.startsWith('=') ? trimmed : `=${trimmed}`;
  }

  // Apply a bound parameter's transform expression to the incoming source value.
  // The live source value is exposed to the expression as `bound` (and `self`). Only scalar
  // numeric values are transformed; vectors and non-numbers pass through unchanged, and any
  // evaluation error falls back to the raw driven value so a bad expression can't blank output.
  _applyTransform(targetNode, targetParamName, sourceValue) {
    const targetKey = `${targetNode.id}.${targetParamName}`;
    const transform = this.transforms.get(targetKey);
    if (!transform) return sourceValue;
    if (typeof sourceValue !== 'number') return sourceValue;

    try {
      const result = this.expressionSystem.evaluateExpression(
        transform,
        { bound: sourceValue, self: sourceValue },
        targetNode,
      );
      return (typeof result === 'number' && isFinite(result)) ? result : sourceValue;
    } catch {
      return sourceValue;
    }
  }

  // Read a parameter's RAW stored value (an expression string is returned as-is, not evaluated).
  // node.params is checked FIRST: it's where the expression-aware value manager and the shader
  // codegen both keep the live value (e.g. a ConstFloat's "=sin(time)"). The legacy top-level
  // node.value / node.expr can lag behind as a stale number, so they're only a fallback.
  _getRawValue(node, paramName) {
    if (!node) return undefined;
    if (node.params && node.params[paramName] !== undefined) return node.params[paramName];
    if (paramName === 'value' && node.value !== undefined) return node.value;
    if (paramName === 'expr' && node.expr !== undefined) return node.expr;
    if (node.props && node.props[paramName] !== undefined) return node.props[paramName];
    return undefined;
  }

  // Compute what a bound target should store for its current source + transform.
  //
  // Two regimes:
  //  - Static numeric source → a plain number (source value run through the transform). This stays a
  //    GPU uniform and avoids shader recompiles, exactly as before.
  //  - Expression source (=audioEnvelope, =time, ...) → a composed EXPRESSION string. The source's
  //    value changes every frame on the GPU without firing PARAMETER_CHANGED, so a snapshot number
  //    would freeze the target. Emitting an expression instead lets the target compile/animate live
  //    just like the source. The transform's `bound`/`self` identifiers are substituted with the
  //    source expression, so "=bound * 2" over "=audioEnvelope" becomes "=(audioEnvelope) * 2".
  _composeTargetValue(targetNode, targetParamName, sourceNode, sourceParamName) {
    const rawSource = this._getRawValue(sourceNode, sourceParamName);

    if (this.expressionSystem.isExpression(rawSource)) {
      const sourceBody = `(${rawSource.trim().slice(1).trim()})`;
      const targetKey = `${targetNode.id}.${targetParamName}`;
      const transform = this.transforms.get(targetKey);
      if (transform) {
        const body = transform.trim().slice(1).trim()
          .replace(/\bbound\b/g, sourceBody)
          .replace(/\bself\b/g, sourceBody);
        return `=${body}`;
      }
      return `=${sourceBody}`;
    }

    const sourceValue = this.getParameterValue(sourceNode, sourceParamName);
    return this._applyTransform(targetNode, targetParamName, sourceValue);
  }

  // A composed expression target must be recompiled to take effect on the main output (unlike a
  // numeric uniform, which updates live). Binding changes don't otherwise trigger a rebuild, so
  // request one when we've written an expression value. No-op for plain numbers.
  _requestRebuildIfExpression(value) {
    if (this.expressionSystem.isExpression(value)
        && typeof window !== 'undefined'
        && window.editor?.onChange) {
      window.editor.onChange('Bound parameter expression update');
    }
  }

  // Read the transform expression attached to a bound parameter (or null if none).
  getBoundTransform(targetNodeId, targetParamName) {
    return this.transforms.get(`${targetNodeId}.${targetParamName}`) ?? null;
  }

  // Attach/replace/clear the transform expression for a bound parameter, then re-apply it
  // against the current source value so the change takes effect immediately. A parameter must
  // already be bound for a transform to be meaningful. Returns true if anything changed.
  setBoundTransform(targetNodeId, targetParamName, expression) {
    const targetKey = `${targetNodeId}.${targetParamName}`;
    if (!this.boundToSource.has(targetKey)) {
      return false;
    }

    const targetNode = this.graph.nodes.find(n => n.id === targetNodeId);
    if (!targetNode) {
      return false;
    }

    const normalized = this._normalizeTransform(expression);
    const previous = this.transforms.get(targetKey) ?? '';
    if (normalized === previous) {
      return false;
    }

    if (normalized) {
      this.transforms.set(targetKey, normalized);
    } else {
      this.transforms.delete(targetKey);
    }

    // Re-evaluate against the current source so the transformed value is live immediately (a
    // composed expression when the source is an expression, otherwise a plain number).
    const source = this.boundToSource.get(targetKey);
    const sourceNode = this.graph.nodes.find(n => n.id === source.nodeId);
    if (sourceNode) {
      const composed = this._composeTargetValue(targetNode, targetParamName, sourceNode, source.parameterName);
      this.setParameterValueDirect(targetNode, targetParamName, composed);
      this._requestRebuildIfExpression(composed);
    }

    this.updateNodePreview(targetNode);

    this.eventSystem.emit('BINDING_TRANSFORM_CHANGED', {
      targetNodeId,
      targetParamName,
      transform: normalized,
    });

    return true;
  }

  // Live-propagate an in-progress drag of a source node to every parameter bound to it.
  //
  // Bindings aren't graph edges, so the preview dependency walk can't see them; and the numeric
  // drag handlers only fire PARAMETER_CHANGED (which drives updateBoundParameters) on mouse-up.
  // Without this, a bound parameter's thumbnail freezes until the drag is released. The source
  // node.params are already live (the drag handler updates them every move), so we read the current
  // source value, run each binding's transform, write the result into the target's node.params, and
  // keep its GPU uniform in sync so both the main canvas and the thumbnail track the drag. Returns
  // the set of affected target nodes so the caller can refresh their previews in the same pass.
  refreshLiveTargetsForSource(sourceNode) {
    const affected = new Set();
    if (!sourceNode) return affected;

    const prefix = `${sourceNode.id}.`;
    const uniformManager = (typeof window !== 'undefined')
      ? window.nodeCompiler?.uniformManager
      : null;

    this.bindings.forEach((targets, sourceKey) => {
      if (!sourceKey.startsWith(prefix)) return;
      const sourceParamName = sourceKey.slice(prefix.length);

      targets.forEach(bound => {
        const targetNode = this.graph.nodes.find(n => n.id === bound.nodeId);
        if (!targetNode) return;

        const finalValue = this._composeTargetValue(
          targetNode, bound.parameterName, sourceNode, sourceParamName,
        );
        this.setParameterValueDirect(targetNode, bound.parameterName, finalValue);

        if (uniformManager && typeof finalValue === 'number') {
          uniformManager.uniformValues.set(`${targetNode.id}.${bound.parameterName}`, finalValue);
        }

        affected.add(targetNode);
      });
    });

    return affected;
  }

  // Check if creating a binding would create circular dependency
  wouldCreateCircularDependency(sourceNodeId, sourceParamName, targetNodeId, targetParamName) {
    const visited = new Set();
    
    const checkPath = (nodeId, paramName) => {
      const key = `${nodeId}.${paramName}`;
      
      if (visited.has(key)) return true; // Circular dependency found
      if (nodeId === sourceNodeId && paramName === sourceParamName) return true;
      
      visited.add(key);
      
      const boundParams = this.bindings.get(key);
      if (boundParams) {
        for (const bound of boundParams) {
          if (checkPath(bound.nodeId, bound.parameterName)) {
            return true;
          }
        }
      }
      
      visited.delete(key);
      return false;
    };
    
    return checkPath(targetNodeId, targetParamName);
  }

  // Get binding information for a parameter
  getBindingInfo(nodeId, parameterName) {
    const targetKey = `${nodeId}.${parameterName}`;
    const sourceKey = `${nodeId}.${parameterName}`;
    
    const source = this.boundToSource.get(targetKey);
    const targets = this.bindings.get(sourceKey);
    
    return {
      isBound: !!source,
      hasTargets: !!(targets && targets.size > 0),
      source,
      targets: targets ? Array.from(targets) : [],
      transform: this.transforms.get(targetKey) ?? null
    };
  }

  // Check if a parameter is bound to another
  isParameterBound(nodeId, parameterName) {
    const targetKey = `${nodeId}.${parameterName}`;
    return this.boundToSource.has(targetKey);
  }

  // Get all bindings in the system
  getAllBindings() {
    const result = [];
    
    this.bindings.forEach((targets, sourceKey) => {
      const [sourceNodeId, sourceParamName] = sourceKey.split('.');
      targets.forEach(target => {
        result.push({
          source: { nodeId: sourceNodeId, parameterName: sourceParamName },
          target: { nodeId: target.nodeId, parameterName: target.parameterName }
        });
      });
    });
    
    return result;
  }

  // Utility methods for getting/setting parameter values
  getParameterValue(node, paramName) {
    if (window.editor?.paramPanel?.valueManager) {
      return window.editor.paramPanel.valueManager.getValue(node, paramName);
    }
    return node.params?.[paramName];
  }

  setParameterValue(node, paramName, value) {
    if (window.editor?.paramPanel?.valueManager) {
      window.editor.paramPanel.valueManager.setValue(node, paramName, value);
    } else {
      if (!node.params) node.params = {};
      node.params[paramName] = value;
    }
  }

  setParameterValueDirect(node, paramName, value) {
    // Direct assignment without triggering events
    if (!node.params) node.params = {};
    node.params[paramName] = value;

    // Mirror to the legacy top-level property for ConstFloat (node.value).
    // NOTE: 'x'/'y'/'z' are deliberately NOT mirrored — node.x/node.y are the node's canvas
    // position; ConstVec component values live in node.params only. Writing them onto the
    // node would move it whenever a bound/automated component value changed.
    if (paramName === 'value') {
      node.value = value;
    }
  }

  updateNodePreview(node) {
    if (window.editor?.paramPanel?.updateNodePreview) {
      window.editor.paramPanel.updateNodePreview(node);
    }
  }

  // UI helper methods (to be implemented based on your UI system)
  getSelectedNode() {
    return window.editor?.selectionManager?.getSelectedNode();
  }

  getSelectedParameter() {
    // This would need to be implemented based on your parameter panel UI
    const paramPanel = window.editor?.paramPanel;
    if (paramPanel?.isVisible() && paramPanel?.selectedNode) {
      // You'd need to track which parameter is currently focused/selected
      const focusedInput = document.querySelector('.param-input:focus');
      if (focusedInput) {
        const paramName = focusedInput.getAttribute('data-param');
        return { name: paramName };
      }
    }
    return null;
  }

  showCopyFeedback(_node, _param) {
    // Visual feedback when copying - implement based on your UI
  }

  showBindingCreatedFeedback(_sourceNode, _sourceParam, _targetNode, _targetParam) {
    // Visual feedback when binding created - implement based on your UI
  }

  // Cleanup when node is deleted
  cleanupNodeBindings(nodeId) {
    // Remove all bindings where this node is source
    const toRemoveAsSource = [];
    this.bindings.forEach((targets, sourceKey) => {
      if (sourceKey.startsWith(`${nodeId}.`)) {
        toRemoveAsSource.push(sourceKey);
      }
    });
    
    toRemoveAsSource.forEach(sourceKey => {
      // Drop transforms on the targets that were driven by this (now-deleted) source.
      const targets = this.bindings.get(sourceKey);
      if (targets) {
        targets.forEach(target => {
          this.transforms.delete(`${target.nodeId}.${target.parameterName}`);
        });
      }
      this.bindings.delete(sourceKey);
    });

    // Remove all bindings where this node is target
    const toRemoveAsTarget = [];
    this.boundToSource.forEach((source, targetKey) => {
      if (targetKey.startsWith(`${nodeId}.`)) {
        toRemoveAsTarget.push(targetKey);
      }
    });
    
    toRemoveAsTarget.forEach(targetKey => {
      const source = this.boundToSource.get(targetKey);
      if (source) {
        this.removeBinding(source.nodeId, source.parameterName, nodeId, targetKey.split('.')[1]);
      }
    });
  }

  // Serialize bindings for save/load
  serialize() {
    return {
      bindings: Array.from(this.bindings.entries()).map(([sourceKey, targets]) => ({
        source: sourceKey,
        targets: Array.from(targets)
      })),
      transforms: Array.from(this.transforms.entries()).map(([target, expression]) => ({
        target,
        expression
      }))
    };
  }

  // Load bindings from serialized data
  deserialize(data) {
    this.bindings.clear();
    this.boundToSource.clear();
    this.transforms.clear();

    if (data.transforms) {
      data.transforms.forEach(({ target, expression }) => {
        const normalized = this._normalizeTransform(expression);
        if (target && normalized) {
          this.transforms.set(target, normalized);
        }
      });
    }

    if (data.bindings) {
      data.bindings.forEach(binding => {
        const sourceKey = binding.source;
        const targets = new Set(binding.targets);
        
        this.bindings.set(sourceKey, targets);
        
        // Rebuild reverse map
        targets.forEach(target => {
          const targetKey = `${target.nodeId}.${target.parameterName}`;
          const [sourceNodeId, sourceParamName] = sourceKey.split('.');
          this.boundToSource.set(targetKey, {
            nodeId: sourceNodeId,
            parameterName: sourceParamName
          });
        });
      });
    }
  }

  // Debug methods
  debugPrintBindings() {
    this.bindings.forEach((targets, _sourceKey) => {
      targets.forEach(_target => {
      });
    });
  }

  destroy() {
    this.bindings.clear();
    this.boundToSource.clear();
    this.transforms.clear();
    this.clipboard = null;
  }
}
