/**
 * actions.js - everything the performer can do, in one list.
 *
 * This module is the whole vocabulary. Nothing else in src/performer/ invents
 * a verb: a scenario written by hand, a cue fired over OSC and a plan that
 * came back from the model all reduce to actions from this table, and that is
 * what makes the fence in Scenario.normalizeRules() enforceable — there is one
 * place to check `allowGraphEdits`, because there is one action that edits the
 * graph.
 *
 * It is also the schema the model answers in. `ACTION_TYPES` below is the
 * source the backend's JSON schema is written from, so a verb added here has
 * to be added there too (api/_lib/features.js, `ai.performer_live`) before the
 * model can use it — the mirror is deliberate and the comment there says so.
 *
 * Every action is data: a plain object with a `type` and its own fields. They
 * are queued, quantised, logged and replayed, so none of them may hold a
 * function or a node reference. A node is named, never held — the graph it
 * belongs to is reloaded on every scene change and a captured reference would
 * be writing into a node that is no longer on the canvas.
 */

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const str = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

/**
 * The vocabulary.
 *
 * `cost` is what the action spends against `maxActionsPerBar`. A scene load
 * rebuilds the graph and recompiles the shader; a parameter write is a float
 * into a uniform buffer. Counting them the same would either throttle the
 * cheap ones pointlessly or let the dear ones through in a burst.
 *
 * `gate` names the rule that has to be true for the action to run at all.
 */
export const ACTION_TYPES = Object.freeze({
  scene: {
    summary: 'Switch to a scene, through a transition.',
    fields: ['scene', 'transition', 'duration'],
    cost: 4,
    gate: 'allowSceneChanges',
  },
  preset: {
    summary: 'Apply a parameter preset, optionally blended over time.',
    fields: ['preset', 'overSeconds'],
    cost: 2,
    gate: 'allowPresets',
  },
  param: {
    summary: 'Move one parameter to a value, instantly or over bars.',
    fields: ['node', 'param', 'to', 'overBars', 'overSeconds', 'curve'],
    cost: 1,
    gate: 'allowParameterMoves',
  },
  drive: {
    summary: 'Bind a live signal to a parameter for the rest of the section.',
    fields: ['signal', 'node', 'param', 'min', 'max', 'curve', 'invert', 'smooth'],
    cost: 1,
    gate: 'allowParameterMoves',
  },
  undrive: {
    summary: 'Release a parameter a signal was driving.',
    fields: ['node', 'param'],
    cost: 1,
    gate: null,
  },
  transition: {
    summary: 'Set the transition the next scene change uses.',
    fields: ['transition', 'duration'],
    cost: 1,
    gate: null,
  },
  master: {
    summary: 'Move the master fader.',
    fields: ['to', 'overSeconds'],
    cost: 1,
    gate: null,
  },
  speed: {
    summary: 'Set playback speed.',
    fields: ['to'],
    cost: 1,
    gate: null,
  },
  blackout: {
    summary: 'Kill or restore the output. Ignores the master floor.',
    fields: ['on'],
    cost: 1,
    gate: null,
  },
  section: {
    summary: 'Jump to a section.',
    fields: ['to'],
    cost: 2,
    gate: null,
  },
  cue: {
    summary: 'Fire a named cue from this scenario.',
    fields: ['name'],
    cost: 1,
    gate: null,
  },
  graph: {
    summary: 'Replace the patch with a generated one. Recompiles the shader.',
    fields: ['patch', 'reason'],
    cost: 8,
    gate: 'allowGraphEdits',
  },
  log: {
    summary: 'Write a line to the performance log. Does nothing on screen.',
    fields: ['message'],
    cost: 0,
    gate: null,
  },
});

/** Action type names, for schemas and menus. */
export const ACTION_TYPE_NAMES = Object.freeze(Object.keys(ACTION_TYPES));

/** What an action costs against the per-bar budget. */
export function actionCost(action) {
  return ACTION_TYPES[action?.type]?.cost ?? 1;
}

/** The rule that has to be on for an action to run, or null when it is always allowed. */
export function actionGate(action) {
  return ACTION_TYPES[action?.type]?.gate ?? null;
}

/**
 * Coerce one action. Returns null for anything that is not a verb we know,
 * which is how a plan from a model that invented a verb loses that one line
 * rather than the whole plan.
 */
export function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = str(raw.type).trim();
  if (!Object.prototype.hasOwnProperty.call(ACTION_TYPES, type)) return null;

  // `quantize` and `why` are on every action rather than per-type: the first
  // is how the engine schedules it, the second is what the log and the panel
  // show the artist when the performer does something surprising.
  const common = {
    type,
    quantize: str(raw.quantize) || null,
    why: str(raw.why),
  };

  switch (type) {
    case 'scene':
      return {
        ...common,
        scene: str(raw.scene ?? raw.sceneId ?? raw.to),
        transition: str(raw.transition),
        duration: raw.duration === undefined ? null : clamp(num(raw.duration, 1), 0, 60),
      };

    case 'preset':
      return {
        ...common,
        preset: str(raw.preset ?? raw.presetId ?? raw.to),
        overSeconds: clamp(num(raw.overSeconds ?? raw.blendSeconds, 0), 0, 60),
      };

    case 'param': {
      const overBars = raw.overBars === undefined ? null : clamp(num(raw.overBars, 0), 0, 256);
      const overSeconds = raw.overSeconds === undefined ? null : clamp(num(raw.overSeconds, 0), 0, 600);
      return {
        ...common,
        node: str(raw.node ?? raw.nodeId),
        param: str(raw.param ?? raw.parameter),
        to: num(raw.to ?? raw.value, 0),
        overBars,
        overSeconds,
        curve: str(raw.curve) || 'linear',
      };
    }

    case 'drive':
      return {
        ...common,
        signal: str(raw.signal),
        node: str(raw.node ?? raw.nodeId),
        param: str(raw.param ?? raw.parameter),
        min: num(raw.min, 0),
        max: num(raw.max, 1),
        curve: str(raw.curve) || 'linear',
        invert: Boolean(raw.invert),
        smooth: clamp(num(raw.smooth, 0), 0, 10),
      };

    case 'undrive':
      return {
        ...common,
        node: str(raw.node ?? raw.nodeId),
        param: str(raw.param ?? raw.parameter),
      };

    case 'transition':
      return {
        ...common,
        transition: str(raw.transition ?? raw.transitionType ?? raw.to),
        duration: raw.duration === undefined ? null : clamp(num(raw.duration, 1), 0, 60),
      };

    case 'master':
      return {
        ...common,
        to: clamp(num(raw.to ?? raw.value, 1), 0, 1),
        overSeconds: clamp(num(raw.overSeconds, 0), 0, 60),
      };

    case 'speed':
      // The editor's own speed control tops out well below this; the ceiling
      // here is only to keep a nonsense value out of the render loop.
      return { ...common, to: clamp(num(raw.to ?? raw.value, 1), 0, 8) };

    case 'blackout':
      return { ...common, on: raw.on === undefined ? true : Boolean(raw.on) };

    case 'section':
      return { ...common, to: str(raw.to ?? raw.section ?? raw.id) };

    case 'cue':
      return { ...common, name: str(raw.name ?? raw.cue) };

    case 'graph':
      return {
        ...common,
        patch: raw.patch && typeof raw.patch === 'object' ? raw.patch : null,
        reason: str(raw.reason),
      };

    case 'log':
      return { ...common, message: str(raw.message) };

    default:
      return null;
  }
}

/**
 * What is wrong with one action, or null.
 *
 * Severity is the difference between "this line will do nothing" (error) and
 * "this line will do something you may not have meant" (warning). Both are
 * reported; neither stops a set.
 *
 * @param {object} action a NORMALISED action
 * @param {{sectionIds?: Set, cueNames?: Set, known?: object, rules?: object}} context
 */
export function validateAction(action, context = {}) {
  if (!action) return { severity: 'error', message: 'Unknown action — it will be ignored.' };

  const { sectionIds, cueNames, known = {}, rules } = context;
  const error = (message) => ({ severity: 'error', message });
  const warn = (message) => ({ severity: 'warning', message });

  const gate = actionGate(action);
  if (gate && rules && rules[gate] === false) {
    return warn(`"${action.type}" is switched off by rules.${gate}, so it will be skipped.`);
  }

  switch (action.type) {
    case 'scene':
      if (!action.scene) return error('A scene action needs a scene.');
      if (Array.isArray(known.sceneIds) && !known.sceneIds.includes(action.scene)) {
        return warn(`Scene "${action.scene}" is not loaded.`);
      }
      return null;

    case 'preset':
      if (!action.preset) return error('A preset action needs a preset.');
      if (Array.isArray(known.presetIds) && !known.presetIds.includes(action.preset)) {
        return warn(`Preset "${action.preset}" does not exist.`);
      }
      return null;

    case 'param':
      if (!action.node || !action.param) return error('A param action needs a node and a parameter.');
      return null;

    case 'drive':
      if (!action.signal) return error('A drive action needs a signal.');
      if (!action.node || !action.param) return error('A drive action needs a node and a parameter.');
      return null;

    case 'undrive':
      if (!action.node || !action.param) return error('An undrive action needs a node and a parameter.');
      return null;

    case 'section':
      if (!action.to) return error('A section action needs a section to jump to.');
      if (sectionIds && !sectionIds.has(action.to)) {
        return error(`Section "${action.to}" does not exist.`);
      }
      return null;

    case 'cue':
      if (!action.name) return error('A cue action needs a cue name.');
      if (cueNames && !cueNames.has(action.name)) {
        return warn(`Cue "${action.name}" is not declared in this scenario.`);
      }
      return null;

    case 'graph':
      if (!action.patch) return error('A graph action needs a patch.');
      if (rules && !rules.allowGraphEdits) {
        return warn('Graph edits are off for this scenario (rules.allowGraphEdits).');
      }
      return null;

    case 'transition':
      if (!action.transition && action.duration === null) {
        return error('A transition action needs a type or a duration.');
      }
      return null;

    default:
      return null;
  }
}

/** A one-line rendering for the performance log and the panel. */
export function describeAction(action) {
  if (!action) return 'unknown';
  switch (action.type) {
    case 'scene': return `scene → ${action.scene}`;
    case 'preset': return `preset → ${action.preset}`;
    case 'param': {
      const over = action.overBars ? ` over ${action.overBars} bars`
        : action.overSeconds ? ` over ${action.overSeconds}s` : '';
      return `${action.node}.${action.param} → ${action.to}${over}`;
    }
    case 'drive': return `${action.signal} drives ${action.node}.${action.param}`;
    case 'undrive': return `release ${action.node}.${action.param}`;
    case 'transition': return `transition = ${action.transition || action.duration + 's'}`;
    case 'master': return `master → ${action.to}`;
    case 'speed': return `speed → ${action.to}`;
    case 'blackout': return action.on ? 'blackout' : 'blackout off';
    case 'section': return `jump → ${action.to}`;
    case 'cue': return `cue ${action.name}`;
    case 'graph': return `new patch${action.reason ? ` (${action.reason})` : ''}`;
    case 'log': return action.message;
    default: return action.type;
  }
}
