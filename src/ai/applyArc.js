/**
 * applyArc.js - put a director's arc on the timeline.
 *
 * The arc arrives already shaped: finite times inside its own length, in
 * order, one keyframe per instant (api/_lib/directorArc.js). What it cannot
 * know is the canvas. A node may have been deleted while the call was running,
 * a parameter may be a dropdown rather than a number, a value may sit outside
 * the range the editor's own control is clamped to.
 *
 * So nothing is written until the whole arc has been read against the live
 * graph, and what cannot be written is named rather than dropped in silence.
 * An artist who is told "eleven of thirteen moves landed, and here are the
 * two that did not and why" has been told something; one who finds eleven
 * tracks where the panel promised thirteen has not.
 *
 * The other rule is the one every applied AI result here follows: the previous
 * timeline is handed back with the report, so saying yes to an arc is never
 * the same as losing an arrangement.
 */

import { NodeDefs } from '../data/NodeDefs.js';

/** Parameter types a keyframe track can hold: the ones that interpolate. */
export const ANIMATABLE_PARAM_TYPES = new Set(['float', 'int', 'slider']);

/**
 * Read an arc against the graph it would be written onto.
 *
 * Pure: it touches neither the timeline nor the canvas, so the panel can show
 * what applying would do before the artist decides.
 *
 * @param {Object} arc - as returned by the director.
 * @param {Object} options
 * @param {Object} options.graph - the live graph, for the nodes.
 * @param {Object} [options.timelineManager] - to say which moves replace
 *   keyframes the artist already has.
 * @returns {Object} the plan: `moves` that can be written, `skipped` that
 *   cannot with the reason for each, and the counts a dialog needs.
 */
export function planArc(arc, { graph, timelineManager } = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const byId = new Map(nodes.map((node) => [String(node.id), node]));

  const moves = [];
  const skipped = [];
  let keyframeCount = 0;
  let clampedCount = 0;
  let replacedCount = 0;

  for (const move of Array.isArray(arc?.moves) ? arc.moves : []) {
    const nodeId = String(move?.nodeId ?? '');
    const param = String(move?.param ?? '');
    const node = byId.get(nodeId);

    if (!node) {
      skipped.push({ nodeId, param, reason: 'no node with that id is on the canvas' });
      continue;
    }

    const paramDef = (NodeDefs[node.kind]?.params || []).find((entry) => entry?.name === param);
    if (!paramDef) {
      skipped.push({ nodeId, param, reason: `${node.kind} has no parameter called "${param}"` });
      continue;
    }

    if (!ANIMATABLE_PARAM_TYPES.has(paramDef.type)) {
      skipped.push({
        nodeId,
        param,
        reason: `${param} is a ${paramDef.type} parameter, which the timeline cannot interpolate`,
      });
      continue;
    }

    const keyframes = [];
    let clamped = 0;
    for (const keyframe of Array.isArray(move?.keyframes) ? move.keyframes : []) {
      const time = Number(keyframe?.atSeconds);
      const raw = Number(keyframe?.value);
      if (!Number.isFinite(time) || !Number.isFinite(raw)) continue;

      const value = fitToParam(raw, paramDef);
      if (value !== raw) clamped += 1;
      keyframes.push({ time, value, ease: keyframe?.ease || 'linear' });
    }

    if (keyframes.length < 2) {
      skipped.push({ nodeId, param, reason: 'fewer than two usable keyframes' });
      continue;
    }

    // What is there now, so the dialog can say whether this is an addition or
    // a replacement. A move over the artist's own keyframes is the one thing
    // in an arc worth reading twice before saying yes to.
    const replaces = timelineManager?.getKeyframeCount?.(nodeId, param) ?? 0;

    moves.push({
      nodeId,
      param,
      why: String(move?.why ?? ''),
      label: node.name || node.kind,
      paramType: paramDef.type,
      keyframes,
      clamped,
      replaces,
    });

    keyframeCount += keyframes.length;
    clampedCount += clamped;
    if (replaces) replacedCount += 1;
  }

  return {
    title: String(arc?.title ?? ''),
    summary: String(arc?.summary ?? ''),
    durationSeconds: Number(arc?.durationSeconds) || 0,
    sections: Array.isArray(arc?.sections) ? arc.sections : [],
    moves,
    skipped,
    keyframeCount,
    clampedCount,
    replacedCount,
  };
}

/**
 * A value the parameter's own control could have produced.
 *
 * The registry's [min..max] is what the editor clamps a slider to, so a
 * keyframe outside it is a control the artist finds pinned at one end for part
 * of the piece — the same failure a generated patch has when it sets a
 * parameter out of range, and worth catching for the same reason.
 */
function fitToParam(value, paramDef) {
  let fitted = value;
  if (Number.isFinite(paramDef.min)) fitted = Math.max(paramDef.min, fitted);
  if (Number.isFinite(paramDef.max)) fitted = Math.min(paramDef.max, fitted);
  return paramDef.type === 'int' ? Math.round(fitted) : fitted;
}

/**
 * Write a plan onto the timeline.
 *
 * Each move replaces its parameter's track outright rather than merging into
 * it: half an artist's keyframes under half the director's is an arrangement
 * neither of them wrote. Everything else on the timeline is left alone.
 *
 * The arc's length becomes the timeline's, and the loop region with it, because
 * a length is most of what an arc is — and because a loop still set to the old
 * duration is what turns a bar-aligned arc back into something that cannot be
 * played in a set.
 *
 * @returns {Object} `{ backup, moves, keyframes }` — `backup` is the timeline
 *   as it was, for revertArc().
 */
export function applyArc(plan, { timelineManager } = {}) {
  const manager = timelineManager ?? window.timelineManager;
  if (!manager) throw new Error('The timeline is not ready yet.');

  const backup = manager.toJSON();

  let written = 0;
  for (const move of plan.moves) {
    manager.removeAllKeyframes(move.nodeId, move.param);
    for (const keyframe of move.keyframes) {
      manager.addKeyframeAt(move.nodeId, move.param, keyframe.time, keyframe.value, keyframe.ease);
      written += 1;
    }
  }

  if (plan.durationSeconds > 0) {
    manager.setDuration(plan.durationSeconds);
    manager.setLoopRegion(0, plan.durationSeconds);
    manager.setLoop(true);
  }

  // An arc that is on the timeline but not running is a set of tracks nobody
  // can see the effect of. Enabling is also what the confirm dialog warned
  // about — the timeline takes these parameters over — so it happens here,
  // once, rather than leaving the artist to find the switch.
  if (plan.moves.length && !manager.isEnabled()) manager.enable();

  return { backup, moves: plan.moves.length, keyframes: written };
}

/**
 * Put back the timeline an arc replaced.
 *
 * disable() first, and not as tidiness: while the timeline runs it writes its
 * tracks' parameters every frame, and the values it overwrote are held in the
 * manager rather than in the patch. Restoring the tracks without restoring
 * those leaves the canvas sitting at whatever the arc last evaluated to — the
 * artist's arrangement back, and their parameters not.
 */
export function revertArc(backup, { timelineManager } = {}) {
  const manager = timelineManager ?? window.timelineManager;
  if (!manager || !backup) return false;

  if (manager.isEnabled()) manager.disable();
  manager.clear();
  manager.fromJSON(backup);
  return true;
}
