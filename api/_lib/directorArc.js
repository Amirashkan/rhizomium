/**
 * directorArc.js - the shape of a director's arc, and the shaping that guards it.
 *
 * The creative director used to answer in prose alone: a reading of the piece
 * and a list of directions to act on in the next session. Good advice, and
 * nothing an artist could hear. This is the other half of the answer — the
 * same direction written as movement over time, in the one form the editor can
 * play back: keyframes on the parameters the director named.
 *
 * Nothing here knows what is on anyone's canvas. Node ids and parameter names
 * are checked against the live graph in src/ai/applyArc.js, where the graph is;
 * this file only guarantees that what arrives is arithmetic the timeline can
 * hold — finite times inside the arc, in order, on parameters named once.
 *
 * The bounds below are the answer's, not the schema's: Structured Outputs
 * cannot cap an array's length, so a model asked for "up to sixteen moves" can
 * hand back forty. Then this cuts it, rather than the artist finding forty
 * tracks on a timeline they wanted eight of.
 */

/** Interpolation names the editor's InterpolationSystem actually maps. */
export const EASES = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'];

/**
 * How much arc one call may return.
 *
 * A move is one parameter's whole journey through the piece, so sixteen of
 * them is already a dense arrangement — more than that reads as the director
 * automating everything it can see rather than choosing. The keyframe cap is
 * per move and generous: a parameter that pulses once a section through a
 * twelve-section piece is inside it.
 */
export const ARC_LIMITS = {
  maxSections: 12,
  maxMoves: 16,
  maxKeyframesPerMove: 24,
  minDuration: 1,
  maxDuration: 3600,
  /** Below this a move is a constant, not a movement. */
  minKeyframesPerMove: 2,
};

/** Times are held to the millisecond: finer than a frame, coarse enough to compare. */
function roundTime(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

function finite(value) {
  const number = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(number) ? number : null;
}

/**
 * Fit the model's arc to what the timeline can hold.
 *
 * @returns {{ arc: Object|null, warnings: string[] }} `arc` is null when
 *   nothing survived — the prose half of the answer still stands, and the
 *   panel says so rather than offering an empty apply button.
 */
export function shapeArc(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object') return { arc: null, warnings };

  const moves = [];
  const rawMoves = Array.isArray(raw.moves) ? raw.moves : [];

  // The arc's length decides where its keyframes may fall, so it is settled
  // before they are clamped to it. A model that gave no usable duration is
  // taken at the word of its own last keyframe: that is what it drew, whatever
  // it wrote in the field.
  let duration = finite(raw.durationSeconds);
  if (duration === null || duration <= 0) {
    duration = latestKeyframeTime(rawMoves) || 60;
    warnings.push('The arc gave no length, so it is as long as its last keyframe.');
  }
  duration = roundTime(
    Math.min(ARC_LIMITS.maxDuration, Math.max(ARC_LIMITS.minDuration, duration))
  );

  for (const move of rawMoves) {
    if (moves.length >= ARC_LIMITS.maxMoves) {
      warnings.push(
        `The arc had more than ${ARC_LIMITS.maxMoves} moves; the ones past that were dropped.`
      );
      break;
    }

    const nodeId = String(move?.nodeId ?? '').trim();
    const param = String(move?.param ?? '').trim();
    if (!nodeId || !param) continue;

    const keyframes = shapeKeyframes(move?.keyframes, duration);
    if (keyframes.length < ARC_LIMITS.minKeyframesPerMove) {
      // One keyframe is a track that pins a parameter at a value for the whole
      // piece. The artist asked what should move, so a move that does not is
      // dropped rather than quietly freezing a control.
      continue;
    }

    moves.push({
      nodeId,
      param,
      why: String(move?.why ?? '').trim(),
      keyframes,
    });
  }

  const sections = shapeSections(raw.sections, duration);

  return {
    arc: {
      title: String(raw.title ?? '').trim(),
      summary: String(raw.summary ?? '').trim(),
      durationSeconds: duration,
      sections,
      moves,
    },
    warnings,
  };
}

function latestKeyframeTime(moves) {
  let latest = 0;
  for (const move of moves) {
    for (const keyframe of Array.isArray(move?.keyframes) ? move.keyframes : []) {
      const at = finite(keyframe?.atSeconds);
      if (at !== null && at > latest) latest = at;
    }
  }
  return latest;
}

/**
 * One move's keyframes: inside the arc, in time order, one per instant.
 *
 * Two keyframes at the same time are not a shape the timeline has — addKeyframe
 * treats the second as an edit of the first — so the collision is resolved here,
 * where which one wins can be said out loud: the later one in the answer, on the
 * reading that a model writing the same instant twice is correcting itself.
 */
function shapeKeyframes(raw, duration) {
  const byTime = new Map();

  for (const keyframe of Array.isArray(raw) ? raw : []) {
    const at = finite(keyframe?.atSeconds);
    const value = finite(keyframe?.value);
    if (at === null || value === null) continue;

    const time = roundTime(Math.min(duration, Math.max(0, at)));
    const ease = EASES.includes(keyframe?.ease) ? keyframe.ease : 'linear';
    byTime.set(time, { atSeconds: time, value, ease });
  }

  return [...byTime.values()]
    .sort((a, b) => a.atSeconds - b.atSeconds)
    .slice(0, ARC_LIMITS.maxKeyframesPerMove);
}

/**
 * Section markers. They render nothing and drive nothing — they are how the
 * arc explains itself next to the playhead — so an unusable one is dropped and
 * the rest stand.
 */
function shapeSections(raw, duration) {
  const sections = [];

  for (const section of Array.isArray(raw) ? raw : []) {
    if (sections.length >= ARC_LIMITS.maxSections) break;

    const name = String(section?.name ?? '').trim();
    const start = finite(section?.startSeconds);
    if (!name || start === null) continue;

    sections.push({
      name,
      startSeconds: roundTime(Math.min(duration, Math.max(0, start))),
      intent: String(section?.intent ?? '').trim(),
    });
  }

  return sections.sort((a, b) => a.startSeconds - b.startSeconds);
}
