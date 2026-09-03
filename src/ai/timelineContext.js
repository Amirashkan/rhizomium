/**
 * timelineContext.js - what the editor is already doing with time.
 *
 * The creative director is the one feature asked to write time back into the
 * patch, and the patch itself says nothing about time: a graph has no length,
 * no playhead and no tempo. Three facts have to travel separately or the arc
 * that comes back is guesswork —
 *
 *   - how long the timeline is set to run, so an arc is written to the length
 *     the artist chose rather than a length invented for them,
 *   - which parameters already carry keyframes, so an arc knows what it would
 *     be overwriting and can say why,
 *   - the tempo, if the VJ panel has one, so the arc and its sections land on
 *     bar lines and the piece can be dropped into a set.
 *
 * All three are read from whatever is up: an artist who has never opened the
 * timeline sends nothing, and the prompt then says nothing about time rather
 * than describing an empty one.
 */

/** More tracks than this and the list stops being a fact and starts being a dump. */
const MAX_TRACKS_LISTED = 60;

/**
 * @returns {Object|null} the `timing` half of a director payload, or null when
 *   there is nothing to say.
 */
export function buildTimelineContext({ timelineManager, vjPanel } = {}) {
  const manager = timelineManager ?? window.timelineManager;
  const vj = vjPanel ?? window.vjControlPanel;

  const timing = {};

  const timeline = manager?.getTimeline?.();
  if (timeline) {
    const duration = Number(manager.getDuration?.());
    if (Number.isFinite(duration) && duration > 0) timing.durationSeconds = duration;
    timing.loop = Boolean(manager.getLoop?.());

    const tracks = Array.isArray(timeline.tracks) ? timeline.tracks : [];
    const written = tracks
      .filter((track) => track?.keyframes?.length)
      .slice(0, MAX_TRACKS_LISTED)
      .map((track) => ({
        nodeId: String(track.nodeId),
        param: String(track.paramName),
        keyframes: track.keyframes.length,
      }));
    if (written.length) timing.tracks = written;
  }

  // Only when beat sync is actually on. A BPM box sitting at its default of 120
  // in a panel nobody opened is not a tempo anyone performs at, and an arc cut
  // to bar lines at a tempo the artist never chose is worse than one that just
  // picks a round length.
  if (vj?.beatSyncEnabled && vj.beatSyncManager) {
    const bpm = Number(vj.beatSyncManager.bpm);
    if (Number.isFinite(bpm) && bpm > 0) {
      timing.bpm = bpm;
      const beats = Number(vj.beatSyncManager.beatsPerMeasure);
      if (Number.isFinite(beats) && beats > 0) timing.beatsPerBar = beats;
    }
  }

  return Object.keys(timing).length ? timing : null;
}
