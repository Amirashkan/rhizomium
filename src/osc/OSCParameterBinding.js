// src/osc/OSCParameterBinding.js

import { oscArgToNumber } from './OSCDecoder.js';
import {
  applyControlValue,
  clearExternalReadings,
  mapNormalizedValue,
  refreshEditorForControlChange,
  writeParameterUniform,
} from '../parameters/ExternalParameterControl.js';
import { discreteControlRange } from '../utils/discreteParams.js';

/**
 * OSCParameterBinding - maps OSC messages to node parameters.
 *
 * The MIDI equivalent can assume its input range: CC is always 0-127. OSC has
 * no such convention — a fader might send 0-1, a rotary 0-360, a sequencer step
 * 0-16 — so each binding carries the input range it expects and normalises
 * against that before the shared curve/range mapping runs.
 *
 * A binding is keyed by address *and* argument index, because one address
 * commonly carries several values (`/xy 0.3 0.7`), and each should be free to
 * drive a different parameter.
 */
export class OSCParameterBinding {
  constructor(graph, eventSystem, oscManager) {
    this.graph = graph;
    this.eventSystem = eventSystem;
    this.oscManager = oscManager;

    // "address:argIndex" -> binding configs sharing that source.
    //
    // A list rather than a single binding because one OSC channel driving
    // several parameters at once is ordinary in a live set — one LFO opening a
    // radius while it tilts a rotation — and keying one-to-one meant the second
    // mapping silently replaced the first.
    this.bindings = new Map();

    // "nodeId.paramName" -> { address, argIndex }
    this.parameterToOSC = new Map();

    // Parameters driven by OSC, which therefore need a GPU uniform.
    this.oscParameters = new Set();

    this.learningMode = false;
    this.learningTarget = null;

    // Keep listening after a successful learn, so mapping a rack of channels
    // is wiggle-click-wiggle rather than re-arming between every one.
    this.continuousLearn = false;

    this.setupEventListeners();
  }

  setupEventListeners() {
    if (!this.eventSystem) return;

    this.eventSystem.on('OSC_MESSAGE', (data) => {
      this.handleMessage(data);
    });
  }

  static makeKey(address, argIndex) {
    return `${address}:${argIndex}`;
  }

  /**
   * Bind an OSC address (and argument slot) to a node parameter.
   *
   * @param {string} address OSC address pattern, e.g. '/1/fader1'
   * @param {number} argIndex which argument of the message to read
   * @param {string} nodeId
   * @param {string} paramName
   * @param {object} options min/max/inputMin/inputMax/curve/inverted
   */
  createBinding(address, argIndex, nodeId, paramName, options = {}) {
    const node = this.graph?.nodes?.find((n) => n.id === nodeId);
    if (!node) return false;

    const paramDef = this.getParameterDefinition(node, paramName);
    // A dropdown or toggle is addressed by option index and declares no min/max of its own.
    const discreteRange = discreteControlRange(node, paramName);

    // One parameter follows one source; rebinding replaces the old one.
    this.removeBindingForParameter(nodeId, paramName);

    const binding = {
      address,
      argIndex,
      nodeId,
      paramName,
      min: options.min !== undefined ? options.min : (discreteRange?.min ?? paramDef?.min ?? 0),
      max: options.max !== undefined ? options.max : (discreteRange?.max ?? paramDef?.max ?? 1),
      // Most OSC controllers send 0-1; anything else is declared per binding.
      inputMin: options.inputMin !== undefined ? options.inputMin : 0,
      inputMax: options.inputMax !== undefined ? options.inputMax : 1,
      curve: options.curve || 'linear',
      inverted: options.inverted || false,
      enabled: options.enabled !== undefined ? options.enabled : true,
    };

    const key = OSCParameterBinding.makeKey(address, argIndex);
    const atKey = this.bindings.get(key);
    if (atKey) atKey.push(binding);
    else this.bindings.set(key, [binding]);

    this.parameterToOSC.set(`${nodeId}.${paramName}`, { address, argIndex });
    this.oscParameters.add(`${nodeId}.${paramName}`);

    // One recompile so the parameter gets a uniform; after this, updates are
    // buffer writes.
    window.editor?.onChange?.();

    this.eventSystem?.emit('OSC_BINDING_CREATED', binding);
    return true;
  }

  /** Remove every binding fed by this address and argument slot. */
  removeBinding(address, argIndex) {
    const key = OSCParameterBinding.makeKey(address, argIndex);
    const atKey = this.bindings.get(key);
    if (!atKey?.length) return false;

    this.bindings.delete(key);
    for (const binding of atKey) {
      const paramKey = `${binding.nodeId}.${binding.paramName}`;
      this.parameterToOSC.delete(paramKey);
      this.oscParameters.delete(paramKey);
      // An expression naming `osc` reads 0 again once nothing is mapped to it.
      clearExternalReadings(binding.nodeId, binding.paramName);
      this.eventSystem?.emit('OSC_BINDING_REMOVED', binding);
    }
    return true;
  }

  /**
   * Remove the binding driving one parameter.
   *
   * A parameter follows at most one source, so this identifies a single
   * binding even when several share an address — which is what the panel's
   * Remove needs now that they can.
   */
  removeBindingForParameter(nodeId, paramName) {
    const paramKey = `${nodeId}.${paramName}`;
    const source = this.parameterToOSC.get(paramKey);
    if (!source) return false;

    const key = OSCParameterBinding.makeKey(source.address, source.argIndex);
    const atKey = this.bindings.get(key);
    let removed = null;
    if (atKey) {
      const remaining = atKey.filter(
        (b) => !(b.nodeId === nodeId && b.paramName === paramName),
      );
      removed = atKey.find((b) => b.nodeId === nodeId && b.paramName === paramName) ?? null;
      if (remaining.length) this.bindings.set(key, remaining);
      else this.bindings.delete(key);
    }

    this.parameterToOSC.delete(paramKey);
    this.oscParameters.delete(paramKey);
    clearExternalReadings(nodeId, paramName);

    // Announced like any other removal so the panels showing this mapping —
    // the OSC list, the parameter panel's OSC badge — drop it straight away.
    this.eventSystem?.emit('OSC_BINDING_REMOVED', removed ?? { ...source, nodeId, paramName });
    return true;
  }

  /**
   * Handle an incoming OSC message.
   *
   * A message can feed several bindings at once — `/xy 0.3 0.7` driving two
   * parameters is the normal case, not an edge case — so every argument slot is
   * checked rather than just the first match.
   */
  handleMessage(data) {
    const { address, args = [] } = data || {};
    if (!address) return;

    // While continuous learn waits for the next parameter to be picked there is
    // no target, and incoming channels must drive their existing bindings
    // rather than be swallowed by the armed learn.
    if (this.learningMode && this.learningTarget?.nodeId) {
      // Learn from the first argument that carries a number *and has moved*,
      // so a leading label string does not become the source and a rack
      // streaming idle channels does not bind one at random.
      const argIndex = args.findIndex(
        (arg, i) =>
          (typeof arg === 'number' || typeof arg === 'boolean') &&
          this.movedSinceLearnStarted(address, i, oscArgToNumber(arg)),
      );

      if (argIndex >= 0) {
        this.completeLearning(address, argIndex, args);
        return;
      }

      // Nothing moved: this is idle traffic. Fall through so it still drives
      // whatever it is already bound to.
    }

    for (let argIndex = 0; argIndex < Math.max(args.length, 1); argIndex++) {
      const atKey = this.bindings.get(OSCParameterBinding.makeKey(address, argIndex));
      if (!atKey) continue;

      const raw = oscArgToNumber(args[argIndex]);
      for (const binding of atKey) {
        if (binding.enabled) this.updateParameter(binding, raw);
      }
    }
  }

  /** Normalise a raw OSC reading against the binding's declared input range. */
  normalize(binding, rawValue) {
    const span = binding.inputMax - binding.inputMin;
    if (span === 0) return 0;
    return (rawValue - binding.inputMin) / span;
  }

  updateParameter(binding, rawValue) {
    const node = this.graph?.nodes?.find((n) => n.id === binding.nodeId);
    if (!node) return;

    const paramValue = mapNormalizedValue(this.normalize(binding, rawValue), binding);

    // A parameter holding an expression keeps its formula: the reading is recorded and reaches it
    // as `osc` (the MIDI story, in src/parameters/ExternalParameterControl.js) rather than
    // replacing what the user typed.
    applyControlValue(node, binding.paramName, paramValue, 'osc');
    // The uniform carries the raw reading either way, so an expression tracks OSC without a
    // recompile exactly as a plain parameter does.
    writeParameterUniform(binding.nodeId, binding.paramName, paramValue);
    refreshEditorForControlChange('osc-parameter-update');

    this.eventSystem?.emit('PARAMETER_CHANGED', {
      node,
      parameterName: binding.paramName,
      newValue: paramValue,
      controlValue: paramValue,
      source: 'osc',
    });
  }

  /**
   * Wait for the next OSC message and bind it to this parameter.
   */
  startLearning(nodeId, paramName, callback) {
    this.learningMode = true;
    this.learningTarget = { nodeId, paramName, callback };
    this.snapshotForLearn();

    this.eventSystem?.emit('OSC_LEARN_STARTED', { nodeId, paramName });
  }

  /**
   * Record what every channel is currently sending, so learn can wait for one
   * to *move*.
   *
   * Without this, learn binds whatever arrives next — which is fine for a
   * sender that only transmits when you touch a control, and useless for a
   * modular rack or a DAW that streams every channel continuously. There the
   * next message is microseconds away and has nothing to do with the artist's
   * intent, so learn would bind an essentially random channel.
   */
  snapshotForLearn() {
    this.learnBaseline = new Map();

    for (const entry of this.oscManager?.getAddresses?.() ?? []) {
      entry.args?.forEach((arg, argIndex) => {
        this.learnBaseline.set(
          OSCParameterBinding.makeKey(entry.address, argIndex),
          oscArgToNumber(arg),
        );
      });
    }
  }

  /**
   * Has this argument slot moved enough since learn was armed to count as the
   * control the artist just touched?
   *
   * The threshold is relative so it holds for a 0-1 fader and a 0-127 or
   * 0-360 source alike, with an absolute floor for channels sitting at zero.
   */
  movedSinceLearnStarted(address, argIndex, value) {
    // Nothing to compare against (no manager, or a channel first heard now):
    // treat it as movement, which is the old behaviour and the right one for
    // a sender that stays quiet until touched.
    if (!this.learnBaseline?.size) return true;

    const key = OSCParameterBinding.makeKey(address, argIndex);
    if (!this.learnBaseline.has(key)) return true;

    const baseline = this.learnBaseline.get(key);
    const threshold = Math.max(0.01, Math.abs(baseline) * 0.02);
    return Math.abs(value - baseline) > threshold;
  }

  /**
   * Point an armed learn at a different parameter without disarming.
   *
   * What makes mapping a rack tedious is the round trip: arm, wiggle, arm
   * again. With continuous learn on, the panel retargets as the artist selects
   * the next parameter and the next channel binds straight away.
   */
  retargetLearning(nodeId, paramName) {
    if (!this.learningMode) return false;
    if (this.learningTarget?.nodeId === nodeId && this.learningTarget?.paramName === paramName) {
      return false;
    }

    this.learningTarget = { ...this.learningTarget, nodeId, paramName };
    // Fresh baseline: the next map should wait for a new move, not inherit
    // whatever drifted while the artist was picking this parameter.
    this.snapshotForLearn();
    this.eventSystem?.emit('OSC_LEARN_STARTED', { nodeId, paramName });
    return true;
  }

  completeLearning(address, argIndex, args = []) {
    if (!this.learningTarget) return;

    const { nodeId, paramName, callback } = this.learningTarget;

    // Guess the input range from what arrived: a value outside 0-1 means the
    // sender is not using the usual normalised convention, so widen to 0-max
    // rather than clamping everything the artist sends to 1.
    const observed = oscArgToNumber(args[argIndex]);
    const options = {};
    if (observed > 1) options.inputMax = observed;
    else if (observed < 0) options.inputMin = observed;

    const success = this.createBinding(address, argIndex, nodeId, paramName, options);

    if (success) {
      callback?.({ address, argIndex, nodeId, paramName });
      this.eventSystem?.emit('OSC_LEARN_COMPLETED', { address, argIndex, nodeId, paramName });
    }

    if (this.continuousLearn && success) {
      // Stay armed, but stop pointing at the parameter just mapped so the next
      // channel to move cannot overwrite it while the artist picks the next
      // target.
      this.learningTarget = { nodeId: null, paramName: null, callback };
      this.snapshotForLearn();
      this.eventSystem?.emit('OSC_LEARN_AWAITING_TARGET', {});
      return;
    }

    this.cancelLearning();
  }

  /** Turn continuous learn on or off. */
  setContinuousLearn(enabled) {
    this.continuousLearn = !!enabled;
    this.eventSystem?.emit('OSC_LEARN_MODE_CHANGED', { continuous: this.continuousLearn });
  }

  cancelLearning() {
    this.learningMode = false;
    this.learningTarget = null;
    this.eventSystem?.emit('OSC_LEARN_CANCELLED', {});
  }

  /** First binding at this source (see getBindingsAt for all of them). */
  getBinding(address, argIndex) {
    return this.bindings.get(OSCParameterBinding.makeKey(address, argIndex))?.[0];
  }

  /** Every binding fed by this address and argument slot. */
  getBindingsAt(address, argIndex) {
    return this.bindings.get(OSCParameterBinding.makeKey(address, argIndex))?.slice() ?? [];
  }

  getBindingForParameter(nodeId, paramName) {
    const source = this.parameterToOSC.get(`${nodeId}.${paramName}`);
    if (!source) return null;

    const atKey = this.bindings.get(
      OSCParameterBinding.makeKey(source.address, source.argIndex),
    );
    return atKey?.find((b) => b.nodeId === nodeId && b.paramName === paramName) ?? null;
  }

  getAllBindings() {
    return Array.from(this.bindings.values()).flat();
  }

  /**
   * Change a binding's mapping.
   *
   * Targeted by parameter rather than by source: several bindings can share an
   * address now, and editing one range should not move the others.
   */
  updateBindingForParameter(nodeId, paramName, options) {
    const binding = this.getBindingForParameter(nodeId, paramName);
    if (!binding) return false;

    for (const key of ['min', 'max', 'inputMin', 'inputMax', 'curve', 'inverted', 'enabled']) {
      if (options[key] !== undefined) binding[key] = options[key];
    }

    this.eventSystem?.emit('OSC_BINDING_UPDATED', binding);
    return true;
  }

  /** Change every binding fed by this source. */
  updateBinding(address, argIndex, options) {
    const atKey = this.getBindingsAt(address, argIndex);
    if (!atKey.length) return false;

    for (const binding of atKey) {
      this.updateBindingForParameter(binding.nodeId, binding.paramName, options);
    }
    return true;
  }

  setBindingEnabled(address, argIndex, enabled) {
    return this.updateBinding(address, argIndex, { enabled });
  }

  /** Drop bindings for a deleted node so they cannot resurrect a stale id. */
  cleanupNodeBindings(nodeId) {
    for (const binding of this.getAllBindings()) {
      if (binding.nodeId === nodeId) {
        // By parameter, so a sibling binding sharing the address survives.
        this.removeBindingForParameter(nodeId, binding.paramName);
      }
    }
  }

  /** Does this parameter need a GPU uniform? (read during shader compilation) */
  shouldUseUniform(nodeId, paramName) {
    return this.oscParameters.has(`${nodeId}.${paramName}`);
  }

  serialize() {
    return { bindings: this.getAllBindings() };
  }

  deserialize(data) {
    this.bindings.clear();
    this.parameterToOSC.clear();
    this.oscParameters.clear();

    for (const binding of data?.bindings ?? []) {
      if (!binding?.address) continue;

      // Saves predating per-argument bindings carry no argIndex.
      const argIndex = binding.argIndex ?? 0;
      const restored = { ...binding, argIndex };

      const key = OSCParameterBinding.makeKey(binding.address, argIndex);
      const atKey = this.bindings.get(key);
      if (atKey) atKey.push(restored);
      else this.bindings.set(key, [restored]);

      this.parameterToOSC.set(`${binding.nodeId}.${binding.paramName}`, {
        address: binding.address,
        argIndex,
      });
      this.oscParameters.add(`${binding.nodeId}.${binding.paramName}`);
    }
  }

  getParameterDefinition(node, paramName) {
    const definitions = window.editor?.paramPanel?.getParameterDefinitions?.(node);
    return definitions?.find((p) => p.name === paramName) ?? null;
  }

  destroy() {
    this.bindings.clear();
    this.parameterToOSC.clear();
    this.oscParameters.clear();
    this.learningMode = false;
    this.learningTarget = null;
  }
}

export default OSCParameterBinding;
