/**
 * ShowBuilder.js - a manifest in, a performance out.
 *
 * This is the pipeline the manifest exists for. It runs in three passes and
 * the order is the whole design:
 *
 *   1. **Build the looks.** One ai.patch_generator call per look that needs
 *      one, each installed as a scene under the look's name. This is the slow,
 *      expensive half: a call an artist waits on, times however many looks.
 *   2. **Write the set.** One ai.performer_scenario call, told about the
 *      scenes pass 1 just made. This is the call that could not previously be
 *      made usefully on an empty rig — the prompt tells the model not to invent
 *      scene names, so with nothing loaded it writes a set that looks at
 *      nothing.
 *   3. **Bind it.** Reconcile what came back against what was actually built,
 *      by id, then by name, then by position, and set each section's look to
 *      the scene that exists. A section left pointing at a name the model
 *      typed slightly differently is an inert section, and it would be inert
 *      at showtime rather than here.
 *
 * Pass 3 is not a safety net for a bad model. It is the step that makes the
 * difference between generating a document about a show and generating the
 * show: after it, every patch that was built is played by a section, and the
 * scenario's names and the rig's names are the same names.
 *
 * ## Spending someone's allowance
 *
 * Every pass costs. So:
 *
 * - **Nothing already paid for is thrown away.** A look that fails does not
 *   take the looks before it with it; a scenario call that fails does not
 *   discard the patches, it falls back to a scenario written from the manifest
 *   with no model at all. The artist ends up with a playable set either way.
 * - **Out of quota stops the build.** Any other failure is per-look and the
 *   build moves on; a refusal from the gallery means the next call will be
 *   refused too, and spending the rest of a show finding that out twice over
 *   is not diligence.
 * - **The whole thing can be cancelled**, and cancelling between calls is the
 *   only cancellation worth having: a call in flight has already been paid for.
 *
 * ## What it does not do
 *
 * It does not touch the editor. `installScene` is injected by whoever has one
 * — the panel hands it ActionExecutor's, which is the one file allowed to —
 * and so is the model. Both of those out, this is a pure function of the
 * manifest, which is why the tests can build a whole show with no GPU, no
 * network and no account.
 */

import {
  normalizeManifest,
  validateManifest,
  showContext,
  lookPrompt,
  scenarioBrief,
} from './ShowManifest.js';
import { normalizeScenario, SCENARIO_VERSION } from './Scenario.js';

/**
 * A refusal from the gallery — the wrong tier, or an allowance that is spent.
 *
 * Checked by name as well as by class so that a GrantError from another copy
 * of the module (a test double, a bundle that split) is still read as one.
 * Getting this wrong in the safe direction costs a call; getting it wrong in
 * the other direction spends a whole show's worth of them on refusals.
 */
export function isQuotaRefusal(error) {
  return Boolean(error) && (error.name === 'GrantError' || error.code === 'quota_exhausted');
}

const message = (error) => String(error?.message || error || 'unknown error');

export class ShowBuilder {
  /**
   * @param {object} deps
   * @param {Function} deps.generatePatch (prompt, {show, look}) => Promise<{patch, title, notes}>
   * @param {Function} deps.installScene (name, patch, meta) => Promise<{id, name}>|{id, name}
   * @param {Function} [deps.authorScenario] (brief, context) => Promise<{scenario, note, warnings}>
   *   Absent, or refused, and the set is written from the manifest instead.
   * @param {Function} [deps.log] (level, message, meta) => void
   */
  constructor(deps = {}) {
    this.generatePatch = deps.generatePatch || null;
    this.installScene = deps.installScene || null;
    this.authorScenario = deps.authorScenario || null;
    this.log = deps.log || (() => {});
    this.building = false;
  }

  /**
   * Build a show.
   *
   * @param {object} manifest
   * @param {object} [options]
   * @param {object} [options.context] the rig, as PerformerPanel.rigContext()
   *   gives it — merged with the scenes this build installs.
   * @param {Function} [options.onProgress] called with every step, so a panel
   *   can say which look is being built rather than spinning for four minutes.
   * @param {Function} [options.shouldStop] () => boolean, checked between calls.
   * @param {boolean} [options.writeScenario] false to build the looks and
   *   write the set from the manifest without a second model call.
   * @returns {Promise<object>} the report: the scenario, the scenes, and what
   *   went wrong on the way.
   */
  async build(manifest, options = {}) {
    if (this.building) throw new Error('A show is already being built.');

    const show = normalizeManifest(manifest);
    const report = validateManifest(show);
    if (report.errors.length) {
      throw new Error(
        `This manifest cannot be built yet: ${report.errors[0].where} — ${report.errors[0].message}`
      );
    }
    if (!this.generatePatch) throw new Error('The AI is not available in this build.');

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

    this.building = true;
    try {
      const built = [];
      const problems = [];
      let stopped = '';

      // --- pass 1: the looks ---------------------------------------------
      const needed = show.looks.filter((look) => look.brief && !look.scene);

      // A look that names a scene the artist already has is part of the show
      // without costing anything. It goes into the same list so pass 3 binds
      // it exactly like a generated one.
      for (const look of show.looks) {
        if (look.scene) built.push({ lookId: look.id, sceneName: look.scene, generated: false });
      }

      for (const [index, look] of needed.entries()) {
        if (shouldStop()) { stopped = 'cancelled'; break; }

        onProgress({
          phase: 'look', status: 'start', index, total: needed.length,
          lookId: look.id, name: look.name,
          message: `Building "${look.name}" (${index + 1} of ${needed.length})…`,
        });

        try {
          const generated = await this.generatePatch(lookPrompt(show, look), {
            show: showContext(show),
            look,
          });

          const patch = generated?.patch;
          if (!patch || !Array.isArray(patch.nodes) || !patch.nodes.length) {
            throw new Error('the model answered with an empty patch');
          }

          // The scene is named after the look, not after the title the model
          // chose for its patch: the scenario is about to name it, and it can
          // only name what the manifest said.
          const scene = await this.installScene(look.name, patch, {
            notes: generated?.notes || look.mood || look.brief,
            title: generated?.title || look.name,
            lookId: look.id,
          });

          built.push({
            lookId: look.id,
            sceneName: scene?.name || look.name,
            sceneId: scene?.id || null,
            title: generated?.title || look.name,
            notes: generated?.notes || '',
            nodes: patch.nodes.length,
            generated: true,
          });

          onProgress({
            phase: 'look', status: 'ok', index, total: needed.length,
            lookId: look.id, name: look.name,
            message: `"${look.name}" — ${patch.nodes.length} nodes.`,
          });
        } catch (error) {
          problems.push({ where: `look "${look.name}"`, message: message(error) });
          onProgress({
            phase: 'look', status: 'failed', index, total: needed.length,
            lookId: look.id, name: look.name, message: message(error),
          });

          if (isQuotaRefusal(error)) {
            // Nothing after this would get past the gallery either. Stop here
            // and keep everything already built.
            stopped = message(error);
            break;
          }
        }
      }

      // --- pass 2: the set ------------------------------------------------
      let scenario = null;
      let note = '';
      let wrote = 'manifest';

      const wantScenario = options.writeScenario !== false && this.authorScenario && !stopped;

      if (wantScenario) {
        onProgress({ phase: 'scenario', status: 'start', message: 'Writing the set…' });
        try {
          const answer = await this.authorScenario(
            scenarioBrief(show, built),
            mergeContext(options.context, show, built)
          );
          scenario = answer?.scenario || null;
          note = String(answer?.note || '');
          if (scenario) wrote = 'model';
          onProgress({ phase: 'scenario', status: 'ok', message: note || 'Set written.' });
        } catch (error) {
          problems.push({ where: 'the set', message: message(error) });
          onProgress({ phase: 'scenario', status: 'failed', message: message(error) });
          // Deliberately not fatal. The patches are built and paid for; an
          // artist who has them should get a set that plays them, even if the
          // set is the plain one the manifest already describes.
        }
      }

      if (!scenario) scenario = scenarioFromManifest(show, built);

      // --- pass 3: bind ---------------------------------------------------
      const binding = bindLooks(scenario, show, built);
      scenario = binding.scenario;

      onProgress({
        phase: 'done', status: stopped ? 'failed' : 'ok',
        message: stopped
          ? `Stopped: ${stopped}`
          : `${built.filter((entry) => entry.generated).length} looks built, ${scenario.sections.length} sections.`,
      });

      return {
        scenario,
        manifest: show,
        built,
        note,
        wrote,
        problems,
        stopped,
        warnings: report.warnings,
        bound: binding.bound,
        unbound: binding.unbound,
      };
    } finally {
      this.building = false;
    }
  }
}

/**
 * The scenes this build made, added to whatever the rig already had.
 *
 * The scenario call is given the rig so it can name real things. Pass 1's
 * scenes are real — they are installed by the time this runs — but they were
 * not there when the panel read the rig, so without this the model would be
 * told "no scenes are loaded" about the scenes it is being asked to sequence.
 */
function mergeContext(context, show, built) {
  const base = context && typeof context === 'object' ? context : {};
  const existing = Array.isArray(base.scenes) ? base.scenes : [];
  const known = new Set(existing.map((scene) => String(scene?.name)));

  const added = built
    .filter((entry) => entry.generated && !known.has(entry.sceneName))
    .map((entry) => {
      const look = show.looks.find((one) => one.id === entry.lookId);
      return {
        id: entry.sceneId || entry.lookId,
        name: entry.sceneName,
        notes: look?.mood || entry.notes || '',
      };
    });

  return {
    ...base,
    scenes: [...existing, ...added],
    bpm: base.bpm || show.bpm,
  };
}

/**
 * Make every section play the look that was actually built for it.
 *
 * Matching runs id, then name, then position, and stops at the first that
 * works — three passes because a model given ids and told to use them mostly
 * does, and the failures are not random: it renames "opening" to "intro", or
 * it keeps the names and writes them in the right order. Position is last
 * because it is only trustworthy when the counts line up.
 *
 * A look nothing matched gets a section of its own rather than being dropped.
 * The patch for it exists and has been paid for; a set that does not play it
 * is the one outcome this pipeline is for avoiding.
 *
 * Pure, and exported, because it is the step worth testing on its own.
 *
 * @returns {{scenario: object, bound: Array, unbound: Array<string>}}
 */
export function bindLooks(rawScenario, manifest, built = []) {
  const show = normalizeManifest(manifest);
  const scenario = normalizeScenario(rawScenario);
  const sections = scenario.sections.slice();

  const byId = new Map();
  const byName = new Map();
  sections.forEach((section, index) => {
    if (!byId.has(section.id)) byId.set(section.id, index);
    const name = String(section.name || '').toLowerCase();
    if (name && !byName.has(name)) byName.set(name, index);
  });

  const sameLength = sections.length === show.looks.length;
  const taken = new Set();
  const bound = [];
  const unbound = [];

  for (const entry of built) {
    const look = show.looks.find((one) => one.id === entry.lookId);
    if (!look) continue;

    const lookIndex = show.looks.indexOf(look);
    const candidates = [
      byId.get(look.id),
      byName.get(look.name.toLowerCase()),
      sameLength ? lookIndex : undefined,
    ];

    let index = candidates.find((value) => value !== undefined && !taken.has(value));

    if (index === undefined) {
      // Nothing in the set answers to this look. Insert one, at the place the
      // manifest put it, so the order the artist wrote survives.
      index = Math.min(lookIndex, sections.length);
      sections.splice(index, 0, sectionFromLook(look, show, lookIndex === 0));
      // Every index recorded after this one has moved.
      for (const map of [byId, byName]) {
        for (const [key, value] of map) if (value >= index) map.set(key, value + 1);
      }
      for (const value of [...taken]) {
        if (value >= index) { taken.delete(value); taken.add(value + 1); }
      }
      unbound.push(look.id);
    }

    taken.add(index);
    const section = sections[index];

    // The scene name is the rig's, not the scenario's. A section whose look is
    // a name that is nearly right renders nothing and says nothing.
    sections[index] = {
      ...section,
      id: section.id || look.id,
      look: { kind: 'scene', scene: entry.sceneName },
    };

    bound.push({
      lookId: look.id,
      sectionId: sections[index].id,
      sceneName: entry.sceneName,
      inserted: unbound.includes(look.id),
    });
  }

  return { scenario: { ...scenario, sections }, bound, unbound };
}

/** One section, straight off a look, for when nothing wrote one. */
function sectionFromLook(look, show, first) {
  const section = {
    id: look.id,
    name: look.name,
    enter: first ? 'manual' : look.enter || enterFromPrevious(look, show),
    look: look.scene ? { scene: look.scene } : undefined,
    intensity: look.intensity === null ? undefined : look.intensity,
    mood: look.mood || undefined,
    notes: look.notes || undefined,
    next: look.next || undefined,
  };
  if (look.hold) section.hold = look.hold;
  return section;
}

/**
 * What ends the section before this one.
 *
 * A manifest gives each look a length, and a length is exactly the answer:
 * `enter` in a scenario is the condition that ends the PREVIOUS section, so
 * the previous look's hold is what it should be. Without a length anywhere the
 * honest answer is "manual" — a set that advances on a number nobody chose is
 * worse than one the artist moves along themselves.
 */
function enterFromPrevious(look, show) {
  const index = show.looks.findIndex((one) => one.id === look.id);
  const previous = index > 0 ? show.looks[index - 1] : null;
  if (previous?.hold?.bars) return { bars: previous.hold.bars };
  if (previous?.hold?.seconds) return { seconds: previous.hold.seconds };
  return 'manual';
}

/**
 * A scenario written from the manifest alone, with no model in it.
 *
 * Two jobs. It is what pass 2 falls back to when the scenario call fails after
 * the patches are already built and paid for, and it is the whole of a build
 * run with `writeScenario: false` — which is how an artist with one generator
 * call left in their allowance spends it on a look rather than on prose.
 *
 * It is a plain set: the looks in order, each holding for the length the
 * manifest gave it, each entered by the one before it running out. No drives,
 * because the manifest describes parameters in prose and nothing here knows
 * what the generated patches called their nodes. It plays, and the artist can
 * write the drives in the editor — which is where the panel puts it anyway.
 */
export function scenarioFromManifest(manifest, built = []) {
  const show = normalizeManifest(manifest);
  const scenes = new Map(built.map((entry) => [entry.lookId, entry.sceneName]));

  const free = show.pulse === 'free';

  const sections = show.looks.map((look, index) => {
    const section = sectionFromLook(look, show, index === 0);
    const scene = scenes.get(look.id) || look.scene;
    if (scene) section.look = { scene };
    if (!section.next && index < show.looks.length - 1) section.next = show.looks[index + 1].id;
    if (free) {
      // Nothing lands on a bar line in music that has none, so a change waits
      // for the next thing the musician actually plays.
      section.transition = { type: 'crossfade', duration: 2, quantize: 'onset' };
      // A length written in bars still meant something to whoever wrote it —
      // it is just counted against a tempo nobody is playing to. Converting it
      // with the manifest's own tempo keeps the shape of the set the artist
      // described, in the unit this show can actually be played in.
      if (section.hold?.bars) {
        const barSeconds = (60 / show.bpm) * show.beatsPerBar;
        section.hold = { seconds: Math.round(section.hold.bars * barSeconds) };
      }
    }
    return section;
  });

  // A cue named after a look moves the set to it, which is what an artist
  // means by writing "drop" in the cue list of a show whose third look is the
  // drop. Anything else gets a cue that does nothing until they write it —
  // named, so it is one line to fill in rather than one line to discover.
  const cues = show.cues.map((name) => {
    const target = show.looks.find((look) => look.id === name || look.name.toLowerCase() === name.toLowerCase());
    return target
      ? { name, do: [{ type: 'section', to: target.id }] }
      : { name, do: [{ type: 'log', message: `Cue "${name}" — nothing bound to it yet.` }] };
  });

  return normalizeScenario({
    version: SCENARIO_VERSION,
    name: show.name,
    notes: show.brief || show.notes,
    bpm: show.bpm,
    beatsPerBar: show.beatsPerBar,
    barsPerPhrase: show.barsPerPhrase,
    signals: show.signals,
    sections,
    cues,
    rules: show.rules || {
      minSectionBars: free ? 0 : 4,
      allowGraphEdits: false,
      director: free
        ? { enabled: false, everySeconds: 45, freedom: 0.4 }
        : { enabled: false, everyBars: 16, freedom: 0.4 },
    },
  });
}

export default ShowBuilder;
