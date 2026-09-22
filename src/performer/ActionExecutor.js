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
import { resolveLookSound } from './ShowFolder.js';
import { actionCost, actionGate, describeAction } from './actions.js';

/**
 * How long a drive may fail to resolve before it is called out.
 *
 * Short enough that the warning lands while the artist is still looking at the
 * section that caused it. It does not have to cover a scene change: tick()
 * holds the clock at zero while one is in flight, so this only ever waits out
 * the last frames of a transition.
 */
const MISSING_GRACE_SECONDS = 2;

/**
 * How long past a transition's own length a scene load is still believed in.
 *
 * `sceneChangeInFlight` is a latch, and it used to have exactly one way out:
 * the load promise settling. Everything downstream of a scene change waits on
 * it - every later scene change is refused while it is set, and tick() holds
 * the drives' missing-node clock at zero - so a promise that never settles does
 * not degrade the set, it ends it. The look on the output at that moment stays
 * there for the rest of the night, still being driven by the music, and the log
 * says only "a scene change is already running", over and over, with nothing
 * about what is actually stuck.
 *
 * A load that has outlived its own transition by this much has not settled and
 * is not going to. Generous, because the wait is real work - importing a
 * project and compiling its shaders on a rig already drawing sixty frames a
 * second - and because giving up early is its own failure: a second import
 * landing on top of one still running is the race the latch exists to prevent.
 */
const SCENE_LOAD_GRACE_MS = 15_000;

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
    /**
     * The Audio panel's transport, as an object rather than as a panel
     * (src/audio/audioDeck.js). Injected for the same reason replaceGraph is:
     * it reaches the shared capture client, and this file is imported by tests
     * that have no Web Audio to reach.
     */
    this.audioDeck = deps.audioDeck || null;
    this._sceneManager = deps.sceneManager || null;
    this._presetManager = deps.presetManager || null;
    this._transitionManager = deps.transitionManager || null;
    this.log = deps.log || (() => {});
    this.replaceGraph = deps.replaceGraph || null;
    /**
     * Patch -> project data, injected for the same reason replaceGraph is: it
     * lives in the AI layer (src/ai/applyResult.js) and this file is imported
     * by tests that have no editor to import it against.
     */
    this.patchToProjectData = deps.patchToProjectData || null;

    /** Rules from the running scenario. Set by the engine on load. */
    this.rules = null;

    /**
     * The sound in the open show folder, as ShowFolder indexes it. Set by the
     * panel when a folder is opened, so an `audio` action naming a file the
     * way a manifest names it has somewhere to resolve it.
     */
    this.sounds = [];

    /**
     * What the performer itself started playing, so stopping the set stops the
     * bed it started and leaves alone a track the artist loaded by hand. The
     * name is the element's, for the log.
     */
    this._playing = '';

    /**
     * The timeline before the performer armed it, and whether the performer is
     * the one that enabled it. Restoring is the whole point: an artist whose
     * timeline was set to their own 10-second loop should get it back when the
     * set stops, not a duration a section chose.
     */
    this._timelineWas = null;

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
     * When the in-flight load was started, and by when it should have settled.
     * The latch above is only trusted until this passes — see
     * SCENE_LOAD_GRACE_MS and sceneLoadStalled().
     */
    this._sceneChangeDeadline = 0;

    /**
     * Which load the latch belongs to. A load that has been given up on, or
     * superseded, must not clear the flag a newer one has since set — it would
     * hand a second import the run of a graph the first is still replacing.
     */
    this._sceneChangeToken = 0;

    /** The same for a bed: decoding two files onto one element is a race. */
    this.soundLoadInFlight = false;

    /**
     * Node lookup cache, dropped whenever the graph changes. The lookup walks
     * every node, and a section with a dozen drives would otherwise walk it a
     * dozen times a frame.
     */
    this._nodeCache = new Map();
    this._nodeCacheGraph = null;

    /** describePatch()'s cache, and the node array it was built from. */
    this._patchCache = null;
    this._patchCacheFor = null;
    this._patchCacheLength = -1;
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

  /**
   * The editor's timeline, looked up late for the same reason the managers
   * above are: main.js builds it after the performer, and a reference taken in
   * the constructor would be null for the life of the session.
   */
  get timeline() {
    return this.editor?.timelineManager
      || (typeof window !== 'undefined' ? window.timelineManager : null)
      || null;
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
    this._patchCache = null;
    this._patchCacheFor = null;
    this._patchCacheLength = -1;
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

  /**
   * Install a patch as a scene, under a name a scenario can call it by.
   *
   * The show builder generates a patch per look and needs each one to become
   * something a section can cut to. That is a scene, and this is the only file
   * allowed to know what a scene is — so the builder is handed this rather
   * than a SceneManager.
   *
   * Nothing is rendered. The conversion is the same one the AI panel uses to
   * put a generated patch on the canvas, minus the canvas: building a
   * five-look show through the editor would be five full graph rebuilds, five
   * shader compiles, and would leave the artist looking at whichever look
   * happened to be last.
   *
   * A name that is already taken is reused rather than duplicated. A build re-run
   * after a look came out wrong should replace that look, not leave the artist
   * with "Drop" and "Drop 2" and a scenario naming one of them.
   *
   * @param {string} name what the scenario will call it.
   * @param {Object} patch a validated patch from the backend.
   * @param {Object} [meta]
   * @param {string} [meta.notes] the cue note — what this look is for.
   * @param {number} [meta.holdSeconds] how long the look is up for. It becomes
   *   the scene's duration and the timeline the scene carries, so the length
   *   the manifest gave a look is the length the transport shows when the set
   *   cuts to it.
   * @param {Object} [meta.textures] the look's media, keyed by node id, in the
   *   shape a saved project carries: `{ filename, dataUrl, isVideo }`. A look
   *   built on the artist's own footage (ShowFolder.js) arrives with it here,
   *   and it goes into the scene's project data so that loading the scene
   *   restores the clips down the ordinary path — the same one an opened
   *   project takes. A scene whose media lived anywhere else would render
   *   black the first time anything cut to it.
   * @returns {{id: string, name: string}}
   */
  installPatchAsScene(name, patch, meta = {}) {
    const manager = this.sceneManager;
    if (!manager) throw new Error('No scene manager: open the VJ panel first.');
    if (!patch || !Array.isArray(patch.nodes) || !patch.nodes.length) {
      throw new Error('That patch has no nodes in it.');
    }

    const toProject = this.patchToProjectData;
    if (!toProject) throw new Error('Patches cannot be converted in this build.');

    const label = String(name || meta.title || 'Look').trim() || 'Look';
    const projectData = toProject(patch, { title: meta.title || label });

    const textures = meta.textures && typeof meta.textures === 'object' ? meta.textures : null;
    if (textures && Object.keys(textures).length) projectData.textures = textures;

    // The scene's own length, and a timeline enabled at it.
    //
    // A scene IS a project: loading one goes through importProject(), which
    // restores whatever timeline the project carries. A generated patch
    // carried none, so every look installed here was a ten-second scene in the
    // VJ panel's list (SceneManager reads `data.timeline.duration`) and
    // cutting to one left the editor's timeline exactly as the look before it
    // had it. Writing it here is what makes the hold in the manifest reach the
    // transport the artist is looking at.
    //
    // No tracks: nothing generated has keyframes. An empty track list is still
    // the right thing to write — it is what says "this look animates from its
    // own graph", rather than leaving the last scene's tracks pointing at node
    // ids this patch does not have.
    const holdSeconds = Number(meta.holdSeconds);
    if (Number.isFinite(holdSeconds) && holdSeconds > 0) {
      projectData.timeline = {
        enabled: true,
        timeline: {
          duration: holdSeconds,
          currentTime: 0,
          fps: this.timeline?.getFPS?.() || 60,
          loop: true,
          loopStart: 0,
          loopEnd: holdSeconds,
          snapToFrames: true,
          tracks: [],
        },
      };
    }

    const existing = this.resolveScene(label);
    if (existing) {
      existing.data = projectData;
      if (meta.notes) existing.notes = String(meta.notes).slice(0, 300);
      this.log('info', `Scene "${existing.name}" replaced`, {
        nodes: patch.nodes.length,
        ...(textures ? { media: Object.keys(textures).length } : {}),
      });
      return { id: existing.id, name: existing.name };
    }

    const id = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const scene = manager.addScene(id, projectData, label);
    if (meta.notes && manager.updateSceneMetadata) {
      manager.updateSceneMetadata(id, { notes: String(meta.notes).slice(0, 300) });
    }
    this.log('info', `Scene "${label}" added`, {
      nodes: patch.nodes.length,
      ...(textures ? { media: Object.keys(textures).length } : {}),
    });

    return { id: scene?.id || id, name: scene?.name || label };
  }

  // --- the set's own sound -----------------------------------------------
  //
  // A show folder can carry the beds the set was written to (ShowFolder.js).
  // They are not media in the sense the looks are: a clip goes onto a texture
  // node and travels inside the scene, while a bed is played into the one
  // analysis engine the editor has, which is the same engine the artist's
  // microphone would feed. So nothing about them is copied into a patch — the
  // files stay where they are and the performer points the Audio panel at one.

  /**
   * The sound the performer may reach, from the open show folder.
   *
   * @param {Array} items media items, as ShowFolder.indexShowFolder() lists
   *   them. Anything that is not audio is dropped here rather than at the call
   *   site, so a caller can hand over the whole folder.
   */
  setSounds(items) {
    this.sounds = (Array.isArray(items) ? items : []).filter((item) => item?.kind === 'audio');
    return this.sounds.length;
  }

  /** The bed one reference names, matched the way a look's media is matched. */
  resolveSound(reference) {
    return resolveLookSound({ media: this.sounds }, reference);
  }

  /**
   * Play, pause or stop the set's own sound.
   *
   * Synchronous like every other verb here, and for the same reason doScene()
   * is: this runs inside a frame during a show. Resolving the file and
   * refusing a name nothing answers to happens now, where the panel can show
   * it; decoding and starting the track happens on its own time and reports
   * into the log.
   *
   * The load is the expensive half and it is skipped when the file asked for
   * is the one already on the element: a section that re-enters, or two
   * sections sharing a bed, should not decode it again — and reloading would
   * restart a track the set is deliberately playing through.
   */
  doAudio(action) {
    const deck = this.audioDeck;
    if (!deck) return no('there is no audio transport in this build');

    let item = null;
    if (action.clip) {
      item = this.resolveSound(action.clip);
      if (!item) {
        return no(this.sounds.length
          ? `no sound in the folder called "${action.clip}"`
          : `no show folder is open, so there is no "${action.clip}" to play`);
      }
      if (!item.file) return no(`"${item.path}" has no file behind it any more`);
    }

    if (action.transport === 'pause' || action.transport === 'stop') {
      if (action.transport === 'pause') deck.pause();
      else deck.stop();
      this._playing = '';
      return ok(`${item ? `${item.name} ` : ''}${action.transport === 'pause' ? 'paused' : 'stopped'}`);
    }

    if (this.soundLoadInFlight) return no('a bed is already being loaded');
    this.soundLoadInFlight = true;
    this._startSound(deck, item, action)
      .catch((error) => this.log('error', 'The bed would not start', { error: String(error?.message || error) }))
      .finally(() => { this.soundLoadInFlight = false; });

    return ok(item ? `${item.name} playing` : 'playing');
  }

  /** The half of doAudio() that waits: decode, position, start. */
  async _startSound(deck, item, action) {
    if (item && deck.describe().file !== item.name) {
      await deck.load(item.file, item.name);
    }

    // A clip that was just loaded starts at the top unless the action said
    // otherwise — that is what makes a section and its bed the same length.
    if (action.seek !== null) deck.seek(action.seek);
    else if (item) deck.seek(0);

    const started = await deck.play();
    if (!started.ok) {
      this._playing = '';
      this.log('error', `The bed would not start: ${started.reason}`, { clip: item?.name || '' });
      return;
    }

    this._playing = item?.name || deck.describe().file || 'the bed';
    if (started.stoppedLive) {
      // Worth saying out loud: the artist's microphone has just gone quiet,
      // and nothing else in the editor would tell them why.
      this.log('warn', 'Live input stopped — a file and a live input cannot both feed the analysis', {
        was: started.stoppedLive,
        playing: this._playing,
      });
    }
  }

  /**
   * Stop the bed the performer started, and only that.
   *
   * A track the artist loaded into the Audio panel themselves is theirs: the
   * set stopping is not a reason for the room to go quiet.
   */
  stopSound(why = '') {
    if (!this._playing || !this.audioDeck) return false;
    const was = this._playing;
    this._playing = '';
    this.audioDeck.stop();
    this.log('info', `Sound stopped${why ? `: ${why}` : ''}`, { was });
    return true;
  }

  /**
   * Hold the bed where it is, and pick it up there.
   *
   * Pausing a set is a rehearsal stopping to talk about the last section, and
   * the bed is part of that section. It keeps its position — what the set
   * comes back to is the bar it left — and `_playing` is deliberately not
   * cleared: this is the same track, still the performer's.
   */
  pauseSound() {
    if (!this._playing || !this.audioDeck) return false;
    this.audioDeck.pause();
    return true;
  }

  resumeSound() {
    if (!this._playing || !this.audioDeck) return false;
    Promise.resolve(this.audioDeck.play()).then((started) => {
      if (started && started.ok === false) {
        this.log('warn', `The bed would not start again: ${started.reason}`, { was: this._playing });
      }
    }, (error) => {
      this.log('error', 'The bed would not start again', { error: String(error?.message || error) });
    });
    return true;
  }

  // --- the timeline ------------------------------------------------------
  //
  // A section has a length and the editor has a timeline, and until this they
  // knew nothing about each other: a set built from a folder installed its
  // patches and left the timeline at whatever it had been — ten seconds,
  // disabled, playhead at zero. So a look with keyframes on it sat still, and
  // the transport in front of the artist described nothing that was happening.
  //
  // Armed per SECTION rather than per set, because the section is the unit
  // everything else here already agrees on: the scene is the section's, the
  // bed is the section's and restarts with it, and the hold is what both were
  // measured from. One clock, three things reading it.

  /**
   * Set the timeline to this section's length and hand it the playhead.
   *
   * @param {number} seconds the section's hold. Zero or less — a section that
   *   runs until something ends it — leaves the duration alone: whatever the
   *   scene brought with it is a better answer than a number invented here.
   * @returns {{ok: boolean, detail?: string, reason?: string}}
   */
  armTimeline(seconds) {
    const manager = this.timeline;
    if (!manager) return no('there is no timeline in this build');

    // Taken once, on the first arm, so a set of nine sections still restores
    // the artist's own timeline rather than the first section's.
    if (!this._timelineWas) {
      this._timelineWas = {
        enabled: Boolean(manager.isEnabled?.()),
        duration: manager.getDuration?.() ?? null,
        loop: manager.getLoop?.() ?? null,
        loopStart: manager.getLoopStart?.() ?? null,
        loopEnd: manager.getLoopEnd?.() ?? null,
        currentTime: manager.getCurrentTime?.() ?? 0,
      };
    }

    const length = Number(seconds);
    if (Number.isFinite(length) && length > 0) {
      manager.setDuration?.(length);
      manager.setLoopRegion?.(0, length);
      manager.setLoop?.(true);
    }

    // The performer owns the playhead while it runs, so the timeline's own
    // transport is stopped rather than left advancing against it.
    if (manager.isPlaying?.()) manager.pause?.();
    manager.setCurrentTime?.(0);
    if (!manager.isEnabled?.()) manager.enable?.();

    return ok(length > 0 ? `${length.toFixed(1)}s` : "the scene's own length");
  }

  /**
   * Put the playhead where the section is.
   *
   * Wrapped rather than clamped: a section can outlast its hold — the musician
   * has not played the thing that ends it, the director is holding — and the
   * bed under it is looping. A playhead pinned at the end while the sound goes
   * round again is a transport that has stopped describing the set.
   */
  syncTimeline(seconds) {
    const manager = this.timeline;
    if (!manager || !this._timelineWas) return false;

    const position = Number(seconds);
    if (!Number.isFinite(position) || position < 0) return false;

    const duration = manager.getDuration?.() || 0;
    manager.setCurrentTime?.(duration > 0 ? position % duration : position);
    return true;
  }

  /**
   * Give the timeline back.
   *
   * disable() before the rest, for the reason applyArc.revertArc() disables
   * before restoring: while it is enabled the timeline writes its tracks'
   * parameters every frame, and the values it overwrote are held in the
   * manager rather than in the patch.
   */
  releaseTimeline() {
    const manager = this.timeline;
    const was = this._timelineWas;
    this._timelineWas = null;
    if (!manager || !was) return false;

    if (!was.enabled && manager.isEnabled?.()) {
      // Re-read the parameters first. disable() puts back the values it stored
      // when the timeline was enabled, and by now the graph is whatever scene
      // the set finished on rather than the patch those values came off — so
      // restoring them would write a value from one patch into a node that
      // merely shares an id with the one it came from. Storing again makes the
      // restore a no-op against what is actually on the canvas.
      manager.storeOriginalValues?.();
      manager.disable?.();
    }
    if (was.duration > 0) manager.setDuration?.(was.duration);
    if (was.loopEnd > 0) manager.setLoopRegion?.(was.loopStart || 0, was.loopEnd);
    if (was.loop !== null) manager.setLoop?.(was.loop);
    manager.setCurrentTime?.(was.currentTime || 0);
    return true;
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
      // A load still within its deadline is a real one, and a second import on
      // top of it is the race this latch exists for. One past its deadline is
      // wreckage, and refusing behind it would mean refusing every scene change
      // for the rest of the set.
      if (this.sceneChangeInFlight && !this.sceneLoadStalled(now)) {
        // How long, and until when. The bare "already running" was the only
        // line a wedged latch ever put in the log, and it reads as the new
        // change being at fault rather than as the old one never having landed.
        const running = (now - this._lastSceneChangeAt) / 1000;
        const left = Math.max(0, this._sceneChangeDeadline - now) / 1000;
        return `a scene change is already running (${running.toFixed(1)}s so far; `
          + `given up on in ${left.toFixed(1)}s if it has not landed)`;
      }
      this.abandonSceneChange('it never finished loading', now);

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
      case 'audio': return this.doAudio(action);
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

    const manager = this.transitionManager;
    const start = manager?.startTransition
      ? () => manager.startTransition(scene.data, type, duration)
      : (this.sceneManager?.switchToScene
        ? () => this.sceneManager.switchToScene(scene.id)
        : null);
    if (!start) return no('no scene manager');

    // Claimed before the load is kicked off, and only ever released by way of
    // this token: a load given up on by refuse(), or superseded by a later one,
    // must not clear a latch it no longer owns.
    const token = this._sceneChangeToken + 1;
    this._sceneChangeToken = token;
    this.sceneChangeInFlight = true;
    this._lastSceneChangeAt = now;
    // A crossfade legitimately takes its own duration; the grace on top is for
    // the import and the shader compile at the end of it.
    this._sceneChangeDeadline = now + Math.max(0, Number(duration) || 0) * 1000 + SCENE_LOAD_GRACE_MS;

    const release = () => {
      if (token !== this._sceneChangeToken) return false;
      this.sceneChangeInFlight = false;
      this._sceneChangeDeadline = 0;
      return true;
    };
    const finish = () => {
      if (!release()) return;
      // The import replaced every node object in the graph.
      this.invalidateNodes();
      if (this.sceneManager) {
        this.sceneManager.previousSceneId = this.sceneManager.activeSceneId;
        this.sceneManager.activeSceneId = scene.id;
      }
      scene.lastUsed = now;
    };
    const failed = (error) => {
      if (!release()) return;
      this.invalidateNodes();
      this.log('error', `Scene "${scene.name}" failed to load`, { error: String(error) });
    };

    // Promise.resolve(), and a try around the call itself, for the same reason
    // doGraph() has them: a manager that throws on the spot, or hands back
    // something that is not a promise, would otherwise leave the latch set with
    // nothing on its way to clear it.
    try {
      Promise.resolve(start()).then(finish, failed);
    } catch (error) {
      failed(error);
      return no(`scene "${scene.name}" could not be started: ${error?.message || error}`);
    }

    return ok(`${scene.name} (${type}${duration ? ` ${duration}s` : ''})`);
  }

  /**
   * Whether the in-flight scene load has outlived the time it was given.
   *
   * @param {number} [now] wall-clock ms, matching _lastSceneChangeAt
   */
  sceneLoadStalled(now = Date.now()) {
    return this.sceneChangeInFlight
      && this._sceneChangeDeadline > 0
      && now >= this._sceneChangeDeadline;
  }

  /**
   * Give up on an in-flight scene load and let scene changes through again.
   *
   * Said out loud rather than done quietly. From the outside a stuck load and a
   * refusal look identical — the look does not change — and the one line in the
   * log that named the stuck load was the refusal of the *next* scene change,
   * which reads as the new change being at fault.
   *
   * The token is left alone deliberately. If the load is merely slow and does
   * settle later, its `finish` still owns this token and still does its
   * bookkeeping; if a new scene change has started since, that one took the
   * token and the straggler is ignored either way.
   *
   * @returns {boolean} whether there was anything to give up on
   */
  abandonSceneChange(why = 'the set moved on', now = Date.now()) {
    if (!this.sceneChangeInFlight) return false;

    const waited = this._lastSceneChangeAt ? (now - this._lastSceneChangeAt) / 1000 : 0;
    this.sceneChangeInFlight = false;
    this._sceneChangeDeadline = 0;
    // The graph may or may not have been replaced under the failed load. The
    // cache cannot tell, so it is dropped rather than trusted.
    this.invalidateNodes();
    this.log('warn',
      `The scene change started ${waited.toFixed(1)}s ago is being abandoned — ${why}. `
      + 'Scene changes are allowed through again.',
      { waitedSeconds: Number(waited.toFixed(1)) });
    return true;
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
    // A move with no target is not a move to zero. normalizeAction() leaves
    // `to` null when nothing usable arrived, and writing that as a 0 is how
    // "lift the haze a little" becomes a black picture with a line in the log
    // saying it was done.
    if (!Number.isFinite(action.to)) return no('no value to move to');

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

  /**
   * Install a standing drive.
   *
   * The node is deliberately NOT required to exist yet. A section installs its
   * drives in the same frame it cuts to its look, and that look is still
   * loading — refusing here would refuse every drive in every section. What
   * the drive cannot do is fail quietly forever, which is what it used to do:
   * `missingSeconds` below is how tick() notices a drive that never found its node
   * and says so once, instead of a set that runs clean and does not move.
   */
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
      // How long this drive has been writing into nothing. A section declares
      // its drives while the scene it belongs to is still loading, so a drive
      // that does not resolve on the frame it is registered is normal and a
      // refusal here would break every section entry. One that still does not
      // resolve a moment later is a dead handle, and that is worth saying out
      // loud exactly once — see tick().
      missingSeconds: 0,
      reported: false,
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
    // As doParam: a fader move with no level is not a move to the top.
    if (!Number.isFinite(action.to)) return no('no level to move to');

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
    if (!Number.isFinite(action.to)) return no('no speed to move to');

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
    // Which way it goes is the whole action, and it is never guessed: a plan
    // that meant "bring it back" and arrived without `on` used to kill the
    // output instead. Refusing is visible; a wrong guess is a dark room.
    if (action.on === null || action.on === undefined) {
      return no('say on: true to kill the output, false to bring it back');
    }

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
    // Noticed here rather than only when the next scene change is attempted,
    // because a set can go a long section without one — and every frame of that
    // section is a frame the drives below are holding their tongue for a load
    // that is not coming.
    if (this.sceneLoadStalled()) this.abandonSceneChange('it never finished loading');

    for (const drive of this.drives.values()) {
      const node = this.resolveNode(drive.node);
      if (!node) {
        // Silence here was the whole failure. A drive bound to a name the
        // patch does not have used to register cleanly, write nothing for the
        // length of the set, and leave an artist looking at a still frame with
        // a performance log full of successes.
        //
        // The look this drive belongs to may simply still be coming up, and
        // the grace period is not enough on its own: a slow scene change is a
        // long stretch of every drive in the section pointing at nothing. So
        // the clock does not start until the load has settled — or until the
        // top of this function gives up on one that never will.
        if (this.sceneChangeInFlight) continue;

        drive.missingSeconds += delta;
        if (!drive.reported && drive.missingSeconds >= MISSING_GRACE_SECONDS) {
          drive.reported = true;
          this.log('warn',
            `${drive.signal} drives ${drive.node}.${drive.param}, but no node "${drive.node}" `
            + 'is in this patch — the drive is doing nothing',
            { node: drive.node, param: drive.param, signal: drive.signal });
        }
        continue;
      }

      if (drive.reported) {
        // A look that arrived late, or a scene change into a patch that does
        // have the node. Worth saying, because the warning above is alarming
        // and nothing else would ever take it back.
        this.log('info', `${drive.node}.${drive.param} found its node — driving again`,
          { node: drive.node, param: drive.param, signal: drive.signal });
        drive.reported = false;
      }
      drive.missingSeconds = 0;

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

  /**
   * What is actually on the canvas, for the director's prompt.
   *
   * The model is asked to move parameters, and until this existed the only
   * nodes it was ever shown were the ones the scenario's own drives named — so
   * a set whose drives were bound to nodes that are not in the patch taught it
   * those names and it went on asking for more of them. It cannot check a
   * patch it has never been shown.
   *
   * Cached against the node array itself: a project load replaces the array,
   * and adding or removing a node changes its length, so the pair is enough to
   * notice every change that matters here without walking the graph per frame.
   *
   * Bounded rather than complete. This goes into a prompt every time the
   * director is asked, and a hundred-node patch listed in full is a prompt
   * where the music is no longer the biggest thing in it.
   *
   * @param {object} [limits]
   * @param {number} [limits.maxNodes]
   * @param {number} [limits.maxParams] per node
   * @returns {Array<{node: string, kind: string, params: Array<string>}>}
   */
  describePatch({ maxNodes = 40, maxParams = 12 } = {}) {
    const nodes = this.graph?.nodes;
    if (!Array.isArray(nodes)) return [];

    if (this._patchCache && this._patchCacheFor === nodes
      && this._patchCacheLength === nodes.length) {
      return this._patchCache;
    }

    const described = nodes.slice(0, maxNodes).map((node) => ({
      // The name a scenario should write, chosen the way resolveNode() reads
      // one: the artist's own name when there is one, the kind when there is
      // not. The kind rather than the definition's label ("ComputeNoise", not
      // "Compute Noise") — both resolve, and the kind is what a scenario and
      // a look's `requires` are written in, so it is the one to be taught.
      node: customNodeName(node) || String(node?.kind || ''),
      kind: String(node?.kind || ''),
      params: Object.keys(node?.params || {}).slice(0, maxParams),
    }));

    this._patchCache = described;
    this._patchCacheFor = nodes;
    this._patchCacheLength = nodes.length;
    return described;
  }

  /** What the panel shows under "currently driving". */
  status() {
    return {
      drives: [...this.drives.values()].map((d) => ({
        signal: d.signal, node: d.node, param: d.param, min: d.min, max: d.max,
        // A drive that has been looking for its node for longer than the grace
        // period is not driving anything, and the panel should not draw it as
        // though it were.
        bound: !d.reported,
      })),
      ramps: [...this.ramps.values()].map((r) => ({
        node: r.master ? 'master' : r.node,
        param: r.master ? 'opacity' : r.param,
        to: r.to,
        remaining: Math.max(0, r.duration - r.elapsed),
      })),
      blackedOut: this.blackedOut,
      // What the whole output is being multiplied by. Read from MasterOutput
      // rather than remembered here, because the panel's own fader and a MIDI
      // controller both write it without going through this executor.
      master: getMasterOpacity(),
      transition: { ...this.transition },
      sceneChangeInFlight: this.sceneChangeInFlight,
      sceneChangeStalled: this.sceneLoadStalled(),
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
