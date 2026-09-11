/**
 * ActionExecutor.js - the only place the performer touches the editor.
 *
 * Everything upstream of this file deals in data: a scenario is a document, an
 * action is an object, a plan from the model is a list. This is where that
 * becomes a scene load, a uniform write, a fader move. Keeping the boundary
 * sharp is what makes the rest of the subsystem testable without a GPU, and it
 * is where the rules in the scenario are actually enforced — a gate checked
 * anywhere else is a gate something can go around.
 *
 * Three habits run through it:
 *
 * **Nothing is held.** A node is looked up by name every time it is written to.
 * A scene change reloads the graph, so a node reference captured a bar ago is
 * a node that is no longer on the canvas — writing through it would put values
 * into an object nothing renders and leak the old graph besides.
 *
 * **Nothing throws upwards.** This runs inside a frame handler during a show.
 * An action that cannot run returns a reason, which the engine logs and the
 * panel shows. A stack trace on stage helps nobody.
 *
 * **Parameter writes go through the editor's own controller path.** The `osc`
 * source in ExternalParameterControl is exactly this case — an external thing
 * moving a parameter every frame without recompiling the shader — so the
 * performer uses it rather than writing node.params directly. That is what
 * keeps a parameter holding an expression (`=osc * 2`) working under the
 * performer instead of being flattened by it.
 */

import {
  applyControlValue,
  mapNormalizedValue,
  writeParameterUniform,
} from '../parameters/ExternalParameterControl.js';
import { setMasterOpacity, getMasterOpacity } from '../vj/MasterOutput.js';
import { customNodeName, defaultNodeName } from '../core/nodeName.js';
import { actionCost, actionGate, describeAction } from './actions.js';

/** A result every execute() path returns, so the caller never has to guess. */
const ok = (detail = '') => ({ ok: true, detail });
const no = (reason) => ({ ok: false, reason });

export class ActionExecutor {
  /**
   * @param {object} deps
   * @param {object} deps.editor
   * @param {object} [deps.vjPanel] VJControlPanel, when it is up — routing
   *   master and speed through it keeps its faders showing the truth.
   * @param {object} [deps.sceneManager]
   * @param {object} [deps.presetManager]
   * @param {object} [deps.transitionManager]
   * @param {Function} [deps.log] (level, message, meta) => void
   */
  constructor(deps = {}) {
    this.editor = deps.editor || null;
    this.vjPanel = deps.vjPanel || null;
    this._sceneManager = deps.sceneManager || null;
    this._presetManager = deps.presetManager || null;
    this._transitionManager = deps.transitionManager || null;
    this.log = deps.log || (() => {});
    this.replaceGraph = deps.replaceGraph || null;

    /** Rules from the running scenario. Set by the engine on load. */
    this.rules = null;

    /** Default transition, changed by a `transition` action. */
    this.transition = { type: 'crossfade', duration: 1 };

    /**
     * Standing drives: "nodeRef|param" -> drive. The engine owns their
     * lifetime (a section change clears them) but they are applied here so
     * that only one file knows how to write a parameter.
     */
    this.drives = new Map();

    /** Running parameter ramps, keyed the same way. */
    this.ramps = new Map();

    /** Master opacity before a blackout, so the restore goes back to it. */
    this._preBlackoutMaster = null;
    this.blackedOut = false;

    /** Rate limiting. Wall-clock, because these guard expensive work. */
    this._lastSceneChangeAt = 0;
    this._lastGraphEditAt = 0;

    /** A scene load is async; a second one on top of it is a race. */
    this.sceneChangeInFlight = false;

    /**
     * Node lookup cache, dropped whenever the graph changes. The lookup walks
     * every node, and a section with a dozen drives would otherwise walk it a
     * dozen times a frame.
     */
    this._nodeCache = new Map();
    this._nodeCacheGraph = null;
  }

  // --- the managers, looked up late --------------------------------------
  //
  // The VJ panel builds these, and it is built after the editor. Resolving
  // them on each use rather than in the constructor is what lets the performer
  // be constructed first and still find them.

  get sceneManager() {
    return this._sceneManager || this.vjPanel?.sceneManager || null;
  }

  get presetManager() {
    return this._presetManager || this.vjPanel?.presetManager || null;
  }

  get transitionManager() {
    return this._transitionManager || this.vjPanel?.transitionManager || null;
  }

  get graph() {
    return this.editor?.graph || (typeof window !== 'undefined' ? window.graph : null);
  }

  // --- resolution --------------------------------------------------------

  /**
   * Find a node from a scenario's reference.
   *
   * A scenario is written by a human against a patch, and then the patch is
   * edited. Matching on id alone would mean every scenario breaks the first
   * time a node is replaced, so three keys are tried in order of how specific
   * they are: the id, the artist's own name for the node, then the node kind.
   *
   * The kind fallback is what makes "Blur" work in a scenario written before
   * anyone named anything — and it is last precisely because it is ambiguous:
   * a patch with three Blurs gets the first, which is a guess, so it is only
   * reached once the unambiguous keys have missed.
   */
  resolveNode(reference) {
    if (!reference) return null;
    const graph = this.graph;
    const nodes = graph?.nodes;
    if (!Array.isArray(nodes)) return null;

    if (this._nodeCacheGraph !== graph) {
      this._nodeCache.clear();
      this._nodeCacheGraph = graph;
    }

    const key = String(reference);
    const cached = this._nodeCache.get(key);
    // A cached node that has since left the graph is worse than no cache.
    if (cached && nodes.includes(cached)) return cached;

    const wanted = key.toLowerCase();
    let byName = null;
    let byKind = null;

    for (const node of nodes) {
      if (String(node.id) === key) {
        this._nodeCache.set(key, node);
        return node;
      }
      if (!byName && customNodeName(node).toLowerCase() === wanted) byName = node;
      if (!byKind && (String(node.kind).toLowerCase() === wanted
        || defaultNodeName(node).toLowerCase() === wanted)) byKind = node;
    }

    const found = byName || byKind;
    if (found) this._nodeCache.set(key, found);
    return found;
  }

  /** Drop the node cache. Called after anything that rebuilds the graph. */
  invalidateNodes() {
    this._nodeCache.clear();
    this._nodeCacheGraph = null;
  }

  /**
   * Find a scene by id, then by name.
   *
   * Ids are generated (`scene_1712...`), so nobody writes one into a scenario
   * by hand — a scenario says "drop-scene" and means the scene called that.
   */
  resolveScene(reference) {
    const manager = this.sceneManager;
    if (!manager || !reference) return null;

    const direct = manager.getScene?.(reference);
    if (direct) return direct;

    const wanted = String(reference).toLowerCase();
    return (manager.getAllScenes?.() || []).find(
      (scene) => String(scene.name).toLowerCase() === wanted
    ) || null;
  }

  /** The same for presets. */
  resolvePreset(reference) {
    const manager = this.presetManager;
    if (!manager || !reference) return null;

    const all = manager.getAllPresets?.() || [];
    return all.find((preset) => preset.id === reference)
      || all.find((preset) => String(preset.name).toLowerCase() === String(reference).toLowerCase())
      || null;
  }

  // --- the fence ---------------------------------------------------------

  /**
   * Whether an action may run at all, before anything is touched.
   * @returns {string|null} the reason it may not, or null
   */
  refuse(action, now) {
    const rules = this.rules;
    if (!rules) return null;

    const gate = actionGate(action);
    if (gate && rules[gate] === false) return `${action.type} is off (rules.${gate})`;

    if (action.type === 'scene') {
      if (this.sceneChangeInFlight) return 'a scene change is already running';
      const since = (now - this._lastSceneChangeAt) / 1000;
      if (this._lastSceneChangeAt && since < rules.minSceneChangeSeconds) {
        return `only ${since.toFixed(1)}s since the last scene change (rules.minSceneChangeSeconds = ${rules.minSceneChangeSeconds})`;
      }
    }

    if (action.type === 'graph') {
      const since = (now - this._lastGraphEditAt) / 1000;
      if (this._lastGraphEditAt && since < rules.minGraphEditSeconds) {
        return `only ${since.toFixed(1)}s since the last graph edit (rules.minGraphEditSeconds = ${rules.minGraphEditSeconds})`;
      }
    }

    return null;
  }

  // --- execution ---------------------------------------------------------

  /**
   * Run one action.
   *
   * Returns synchronously even for the async ones. A scene load takes as long
   * as importing a project takes, and the frame this was called from is not
   * waiting for it — the in-flight flag above is what stops a second one
   * landing on top.
   *
   * @returns {{ok: boolean, detail?: string, reason?: string, cost: number}}
   */
  execute(action, context = {}) {
    const cost = actionCost(action);
    const now = context.now ?? Date.now();

    const refusal = this.refuse(action, now);
    if (refusal) return { ...no(refusal), cost: 0 };

    let result;
    try {
      result = this._dispatch(action, context, now);
    } catch (error) {
      // A verb that throws is a bug in this file, not a reason to stop a set.
      result = no(`${action.type} failed: ${error?.message || error}`);
    }

    return { ...result, cost: result.ok ? cost : 0 };
  }

  _dispatch(action, context, now) {
    switch (action.type) {
      case 'scene': return this.doScene(action, now);
      case 'preset': return this.doPreset(action);
      case 'param': return this.doParam(action, context);
      case 'drive': return this.doDrive(action);
      case 'undrive': return this.doUndrive(action);
      case 'transition': return this.doTransition(action);
      case 'master': return this.doMaster(action);
      case 'speed': return this.doSpeed(action);
      case 'blackout': return this.doBlackout(action);
      case 'graph': return this.doGraph(action, now);
      case 'log': return ok(action.message);
      // 'section' and 'cue' are the engine's own business: they change where
      // the performance is, not what is on screen. The engine intercepts them
      // before they reach here, so arriving here means a caller passed one
      // through by mistake.
      case 'section':
      case 'cue':
        return no(`${action.type} is handled by the engine, not the executor`);
      default:
        return no(`unknown action "${action.type}"`);
    }
  }

  doScene(action, now) {
    const scene = this.resolveScene(action.scene);
    if (!scene) return no(`no scene "${action.scene}"`);

    const type = action.transition || this.transition.type;
    const duration = action.duration ?? this.transition.duration;

    this.sceneChangeInFlight = true;
    this._lastSceneChangeAt = now;

    const manager = this.transitionManager;
    const finish = () => {
      this.sceneChangeInFlight = false;
      // The import replaced every node object in the graph.
      this.invalidateNodes();
      if (this.sceneManager) {
        this.sceneManager.previousSceneId = this.sceneManager.activeSceneId;
        this.sceneManager.activeSceneId = scene.id;
      }
      scene.lastUsed = now;
    };
    const failed = (error) => {
      this.sceneChangeInFlight = false;
      this.invalidateNodes();
      this.log('error', `Scene "${scene.name}" failed to load`, { error: String(error) });
    };

    if (manager?.startTransition) {
      manager.startTransition(scene.data, type, duration).then(finish, failed);
    } else if (this.sceneManager?.switchToScene) {
      this.sceneManager.switchToScene(scene.id).then(finish, failed);
    } else {
      this.sceneChangeInFlight = false;
      return no('no scene manager');
    }

    return ok(`${scene.name} (${type}${duration ? ` ${duration}s` : ''})`);
  }

  doPreset(action) {
    const preset = this.resolvePreset(action.preset);
    if (!preset) return no(`no preset "${action.preset}"`);

    const manager = this.presetManager;
    if (!manager?.applyPreset) return no('no preset manager');

    manager.applyPreset(preset.id, action.overSeconds || 0)
      .catch((error) => this.log('error', `Preset "${preset.name}" failed`, { error: String(error) }));

    return ok(preset.name);
  }

  /**
   * Move a parameter, now or over time.
   *
   * A ramp is registered rather than animated here: the engine ticks them from
   * the frame loop, so a ramp and a drive and the clock all advance against
   * the same delta. A setTimeout-driven ramp would drift against the music,
   * which for a parameter written in bars is the whole point of writing it in
   * bars.
   */
  doParam(action, context) {
    const node = this.resolveNode(action.node);
    if (!node) return no(`no node "${action.node}"`);

    const key = `${action.node}|${action.param}`;
    const overSeconds = action.overSeconds
      ?? (action.overBars ? action.overBars * (context.secondsPerBar || 2) : 0);

    if (!overSeconds) {
      this.ramps.delete(key);
      this.writeParam(node, action.param, action.to);
      return ok(`${describeAction(action)}`);
    }

    this.ramps.set(key, {
      node: action.node,
      param: action.param,
      from: this.readParam(node, action.param),
      to: action.to,
      elapsed: 0,
      duration: overSeconds,
      curve: action.curve || 'linear',
    });

    return ok(`${describeAction(action)}`);
  }

  doDrive(action) {
    const key = `${action.node}|${action.param}`;
    // A drive and a ramp on one parameter would fight frame by frame. The
    // drive wins because it is the standing instruction; the ramp was a
    // one-off that this supersedes.
    this.ramps.delete(key);
    this.drives.set(key, {
      signal: action.signal,
      node: action.node,
      param: action.param,
      min: action.min,
      max: action.max,
      curve: action.curve,
      invert: action.invert,
      smooth: action.smooth,
      current: null,
    });
    return ok(describeAction(action));
  }

  doUndrive(action) {
    const key = `${action.node}|${action.param}`;
    const had = this.drives.delete(key);
    this.ramps.delete(key);
    return had ? ok(describeAction(action)) : no(`${key} was not being driven`);
  }

  doTransition(action) {
    if (action.transition) this.transition.type = action.transition;
    if (action.duration !== null && action.duration !== undefined) {
      this.transition.duration = action.duration;
    }
    this.transitionManager?.setTransitionType?.(this.transition.type);
    this.transitionManager?.setTransitionDuration?.(this.transition.duration);
    return ok(`${this.transition.type} ${this.transition.duration}s`);
  }

  doMaster(action) {
    const rules = this.rules;
    const ceiling = rules ? rules.masterCeiling : 1;
    const floor = rules ? rules.masterFloor : 0;
    const target = Math.min(ceiling, Math.max(floor, action.to));

    // A blackout is a deliberate override of the floor. Moving the fader while
    // one is up would half-restore the output without clearing the state, so
    // the blackout is lifted first and the log says so.
    if (this.blackedOut && target > 0) {
      this.blackedOut = false;
      this._preBlackoutMaster = null;
    }

    if (!action.overSeconds) {
      this.setMaster(target);
      return ok(target.toFixed(2));
    }

    this.ramps.set('__master', {
      master: true,
      from: getMasterOpacity(),
      to: target,
      elapsed: 0,
      duration: action.overSeconds,
      curve: 'linear',
    });
    return ok(`${target.toFixed(2)} over ${action.overSeconds}s`);
  }

  doSpeed(action) {
    if (this.vjPanel?.setPlaybackSpeed) {
      this.vjPanel.setPlaybackSpeed(action.to);
      return ok(`${action.to}x`);
    }
    if (typeof window !== 'undefined') {
      window.timeScale = action.to;
      window.renderLoop?.setTimeScale?.(action.to);
      if (this.editor) this.editor.timeScale = action.to;
      return ok(`${action.to}x`);
    }
    return no('no render loop to set speed on');
  }

  /**
   * Kill the output, or bring it back.
   *
   * This is the one thing that ignores masterFloor, because it is the control
   * a performer reaches for when something is wrong on screen and a floor that
   * held the output at 20% would defeat it.
   */
  doBlackout(action) {
    if (action.on) {
      if (!this.blackedOut) this._preBlackoutMaster = getMasterOpacity();
      this.blackedOut = true;
      this.ramps.delete('__master');
      setMasterOpacity(0);
      if (this.vjPanel) this.vjPanel.masterOpacity = 0;
      return ok('output killed');
    }

    this.blackedOut = false;
    const restore = this._preBlackoutMaster ?? 1;
    this._preBlackoutMaster = null;
    this.setMaster(restore);
    return ok(`output back at ${restore.toFixed(2)}`);
  }

  doGraph(action, now) {
    if (!action.patch) return no('no patch in the action');

    const apply = this.replaceGraph;
    if (!apply) return no('graph edits are not wired up in this build');

    this._lastGraphEditAt = now;
    Promise.resolve(apply(action.patch, { reason: 'ai-performer' }))
      .then(() => this.invalidateNodes())
      .catch((error) => {
        this.invalidateNodes();
        this.log('error', 'Live patch failed to apply', { error: String(error) });
      });

    return ok(action.reason || 'new patch');
  }

  // --- per-frame work ----------------------------------------------------

  /**
   * Advance drives and ramps. Called once a frame by the engine, after the
   * signal bus has been refreshed.
   *
   * @param {number} delta seconds
   * @param {SignalBus} signals
   */
  tick(delta, signals) {
    for (const drive of this.drives.values()) {
      const node = this.resolveNode(drive.node);
      if (!node) continue;

      const reading = signals ? signals.value(drive.signal) : 0;

      // A drive's own smoothing rides on top of the signal's, so a scenario
      // can have one signal feeding a parameter that snaps and another that
      // lags without declaring the signal twice.
      let normalized = reading;
      if (drive.smooth > 0) {
        const blend = delta > 0 ? 1 - Math.exp(-delta / drive.smooth) : 0;
        drive.current = drive.current === null
          ? reading
          : drive.current + (reading - drive.current) * blend;
        normalized = drive.current;
      }

      this.writeParam(node, drive.param, mapNormalizedValue(normalized, {
        min: drive.min,
        max: drive.max,
        curve: drive.curve,
        inverted: drive.invert,
      }));
    }

    if (this.ramps.size === 0) return;

    for (const [key, ramp] of this.ramps) {
      ramp.elapsed += delta;
      const t = ramp.duration > 0 ? Math.min(1, ramp.elapsed / ramp.duration) : 1;
      const eased = ease(t, ramp.curve);
      const value = ramp.from + (ramp.to - ramp.from) * eased;

      if (ramp.master) {
        this.setMaster(value);
      } else {
        const node = this.resolveNode(ramp.node);
        // A ramp whose node went away with a scene change is dropped rather
        // than left spinning for the rest of its duration.
        if (!node) { this.ramps.delete(key); continue; }
        this.writeParam(node, ramp.param, value);
      }

      if (t >= 1) this.ramps.delete(key);
    }
  }

  /** Clear every standing drive and ramp. Called on a section change. */
  clearDrives() {
    this.drives.clear();
    for (const key of this.ramps.keys()) {
      // The master ramp belongs to the show, not to the section.
      if (key !== '__master') this.ramps.delete(key);
    }
  }

  // --- primitives --------------------------------------------------------

  /**
   * Write one parameter the way an external controller does.
   *
   * `'osc'` as the source is not a white lie: this is the OSC signal arriving
   * through a scenario rather than through a binding, and tagging it that way
   * is what lets a parameter written as `=osc * 2` keep its formula while the
   * performer drives it — see ExternalParameterControl's note on expressions.
   */
  writeParam(node, param, value) {
    if (!Number.isFinite(value)) return false;
    applyControlValue(node, param, value, 'osc');
    writeParameterUniform(node.id, param, value);
    return true;
  }

  /** A parameter's current value, for a ramp to start from. */
  readParam(node, param) {
    const raw = param === 'value' && node.value !== undefined ? node.value : node?.params?.[param];
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  setMaster(value) {
    setMasterOpacity(value);
    // Keep the panel's own fader and readout in step when it is open.
    if (this.vjPanel?.setMasterOpacity) this.vjPanel.setMasterOpacity(value);
    else if (this.vjPanel) this.vjPanel.masterOpacity = value;
  }

  /** What the panel shows under "currently driving". */
  status() {
    return {
      drives: [...this.drives.values()].map((d) => ({
        signal: d.signal, node: d.node, param: d.param, min: d.min, max: d.max,
      })),
      ramps: [...this.ramps.values()].map((r) => ({
        node: r.master ? 'master' : r.node,
        param: r.master ? 'opacity' : r.param,
        to: r.to,
        remaining: Math.max(0, r.duration - r.elapsed),
      })),
      blackedOut: this.blackedOut,
      transition: { ...this.transition },
      sceneChangeInFlight: this.sceneChangeInFlight,
    };
  }
}

/** Matches TransitionManager's easing so a performer ramp feels like a fade. */
function ease(t, curve) {
  switch (curve) {
    case 'exponential': return t * t;
    case 'logarithmic': return Math.sqrt(t);
    case 'smooth': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    default: return t;
  }
}

export default ActionExecutor;
