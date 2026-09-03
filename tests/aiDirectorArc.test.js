// The creative director, given time.
//
// It could already read a patch and say what the piece needed. It could not
// say it in a form anyone could hear: a graph has no length, no playhead and
// no tempo, and the answer came back as prose to act on in the next session.
//
// The arc is the other half — the same direction as keyframes on the timeline,
// which is the one place in this editor where a piece has a shape over time
// and the one thing a VJ can actually play. These tests hold the three parts
// of that together: what the model is told about time, what shape its answer
// is forced into, and what happens when that answer meets a real canvas that
// may have moved under it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shapeArc, ARC_LIMITS, EASES } from '../api/_lib/directorArc.js';
import { featureConfig, buildUserMessage } from '../api/_lib/features.js';
import { getEasingFunction, EasingFunctions } from '../src/utils/InterpolationSystem.js';
import { NodeDefs } from '../src/data/NodeDefs.js';
import { TimelineManager } from '../src/core/TimelineManager.js';
import { planArc, applyArc, revertArc } from '../src/ai/applyArc.js';
import { buildTimelineContext } from '../src/ai/timelineContext.js';

/** A move the shaper will keep, unless a test breaks it on purpose. */
function move(overrides = {}) {
  return {
    nodeId: 'n1',
    param: 'scale',
    why: 'carries the second half',
    keyframes: [
      { atSeconds: 0, value: 1, ease: 'linear' },
      { atSeconds: 30, value: 4, ease: 'ease-in-out' },
    ],
    ...overrides,
  };
}

describe('the arc a director may return', () => {
  it('is part of the answer, not an extra the model may leave out', () => {
    // Structured Outputs guarantees the shape and nothing else, so "no arc" has
    // to be an empty list of moves the panel can read — not a missing field it
    // would have to guess the meaning of.
    const schema = featureConfig('ai.creative_director').format.schema;
    expect(schema.required).toContain('arc');
    expect(schema.properties.arc.required).toEqual(
      expect.arrayContaining(['durationSeconds', 'sections', 'moves'])
    );
  });

  it('offers only interpolations the editor actually maps', () => {
    // An ease the timeline does not know silently becomes linear at playback,
    // which is a director's ramp turning into a straight line for no stated
    // reason. Every name in the schema resolves to a real easing function.
    // getEasingFunction() answers linear for anything it does not recognise, so
    // "it returned a function" proves nothing. Every name but linear has to
    // come back as something else.
    for (const ease of EASES) {
      const easing = getEasingFunction(ease);
      expect(typeof easing).toBe('function');
      if (ease !== 'linear') expect(easing).not.toBe(EasingFunctions.linear);
    }
    expect(getEasingFunction('ease-in')).toBe(EasingFunctions.easeInCubic);
    expect(getEasingFunction('step')).toBe(EasingFunctions.step);
    expect(getEasingFunction('bounce')).toBe(EasingFunctions.linear);
    // And the schema offers exactly those, so the model cannot invent one.
    const keyframe =
      featureConfig('ai.creative_director').format.schema.properties.arc.properties.moves.items
        .properties.keyframes.items;
    expect(keyframe.properties.ease.enum).toEqual(EASES);
  });

  it('tells the model that a track takes a parameter away from the artist', () => {
    // The reason an arc should be a few moves rather than everything it can
    // reach. If this drops out of the prompt, the model has no way to know.
    const prompt = featureConfig('ai.creative_director').system();
    expect(prompt).toMatch(/keyframe timeline/i);
    expect(prompt).toMatch(/no longer the artist's to drag/i);
    expect(prompt).toMatch(/float, int and slider/i);
  });
});

describe('what the editor tells the director about time', () => {
  const patch = { nodes: [{ id: 'n1', kind: 'Circle' }], connections: [] };

  it('says nothing at all when the editor sent nothing', () => {
    // An artist who has never opened the timeline has nothing to say here, and
    // a paragraph saying so costs tokens to tell the model nothing.
    const message = buildUserMessage('ai.creative_director', { patch, brief: '' });
    expect(message).not.toContain('# Time');
  });

  it('works a bar out of the tempo so the arc can land on one', () => {
    const message = buildUserMessage('ai.creative_director', {
      patch,
      timing: { bpm: 128, beatsPerBar: 4, durationSeconds: 60 },
    });
    // 4 beats at 128 BPM is 1.875s, and thirty-two bars is a minute of set.
    expect(message).toContain('one bar is 1.88s');
    expect(message).toContain('thirty-two bars 60s');
  });

  it('names what the artist has already keyframed, and whose it is', () => {
    const message = buildUserMessage('ai.creative_director', {
      patch,
      timing: { tracks: [{ nodeId: 'n1', param: 'radius', keyframes: 4 }] },
    });
    expect(message).toContain('n1.radius (4)');
    expect(message).toMatch(/artist's own arrangement/);
  });
});

describe('shaping an arc the model wrote', () => {
  it('drops a move with a single keyframe', () => {
    // One keyframe is a parameter pinned for the whole piece. The artist asked
    // what should move; a move that does not is not an answer to that.
    const { arc } = shapeArc({
      durationSeconds: 60,
      moves: [move({ keyframes: [{ atSeconds: 0, value: 1, ease: 'linear' }] }), move()],
    });
    expect(arc.moves).toHaveLength(1);
    expect(arc.moves[0].keyframes).toHaveLength(2);
  });

  it('puts keyframes in time order and inside the arc', () => {
    const { arc } = shapeArc({
      durationSeconds: 10,
      moves: [
        move({
          keyframes: [
            { atSeconds: 8, value: 3, ease: 'linear' },
            { atSeconds: 99, value: 4, ease: 'linear' },
            { atSeconds: -5, value: 1, ease: 'linear' },
          ],
        }),
      ],
    });
    expect(arc.moves[0].keyframes.map((k) => k.atSeconds)).toEqual([0, 8, 10]);
  });

  it('lets the later of two keyframes at one instant win', () => {
    // The timeline has no shape for two values at the same time — addKeyframe
    // treats the second as an edit of the first — so the collision is settled
    // here, where which one wins can be said out loud.
    const { arc } = shapeArc({
      durationSeconds: 10,
      moves: [
        move({
          keyframes: [
            { atSeconds: 0, value: 1, ease: 'linear' },
            { atSeconds: 5, value: 2, ease: 'linear' },
            { atSeconds: 5, value: 9, ease: 'step' },
          ],
        }),
      ],
    });
    const [, second] = arc.moves[0].keyframes;
    expect(second).toEqual({ atSeconds: 5, value: 9, ease: 'step' });
  });

  it('takes an arc with no length at the word of its own last keyframe', () => {
    const { arc, warnings } = shapeArc({
      moves: [move({ keyframes: [{ atSeconds: 0, value: 1, ease: 'linear' }, { atSeconds: 45, value: 2, ease: 'linear' }] })],
    });
    expect(arc.durationSeconds).toBe(45);
    expect(warnings.join(' ')).toMatch(/no length/i);
  });

  it('cuts an arc that came back longer than one call may return', () => {
    const many = Array.from({ length: ARC_LIMITS.maxMoves + 4 }, (_, index) =>
      move({ nodeId: `n${index}` })
    );
    const { arc, warnings } = shapeArc({ durationSeconds: 60, moves: many });
    expect(arc.moves).toHaveLength(ARC_LIMITS.maxMoves);
    expect(warnings.join(' ')).toMatch(new RegExp(`more than ${ARC_LIMITS.maxMoves} moves`));
  });

  it('falls back to linear for an ease the timeline does not have', () => {
    const { arc } = shapeArc({
      durationSeconds: 10,
      moves: [
        move({
          keyframes: [
            { atSeconds: 0, value: 1, ease: 'bounce' },
            { atSeconds: 5, value: 2, ease: 'linear' },
          ],
        }),
      ],
    });
    expect(arc.moves[0].keyframes[0].ease).toBe('linear');
  });

  it('answers nothing for nothing rather than inventing an arc', () => {
    expect(shapeArc(null).arc).toBeNull();
    expect(shapeArc({ durationSeconds: 30, moves: [] }).arc.moves).toEqual([]);
  });
});

describe('an arc meeting a real canvas', () => {
  const graph = {
    nodes: [
      { id: 'field', kind: 'ComputeFieldMapper', params: { scale: 1.5, resolution: 96 } },
      { id: 'circle', kind: 'Circle', params: { radius: 0.25 } },
    ],
  };

  let manager;

  beforeEach(() => {
    window.NodeDefs = NodeDefs;
    manager = new TimelineManager({ graph, onChange: () => {} });
    window.timelineManager = manager;
  });

  afterEach(() => {
    delete window.timelineManager;
  });

  it('will not write a move onto a node that is no longer there', () => {
    // A director call is minutes long. What it was written against can be
    // deleted while it runs, and the artist should be told which move that was
    // rather than finding one fewer track than the panel promised.
    const plan = planArc({ durationSeconds: 30, moves: [move({ nodeId: 'gone' })] }, { graph });
    expect(plan.moves).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/no node with that id/);
  });

  it('will not write a move onto a parameter the node does not have', () => {
    const plan = planArc(
      { durationSeconds: 30, moves: [move({ nodeId: 'circle', param: 'wobble' })] },
      { graph }
    );
    expect(plan.skipped[0].reason).toMatch(/Circle has no parameter/);
  });

  it('will not keyframe a parameter that cannot be interpolated', () => {
    // "mode" on ComputeFieldMapper is a dropdown. Half way between "surface"
    // and "instances" is not a render anyone has ever seen.
    const plan = planArc(
      { durationSeconds: 30, moves: [move({ nodeId: 'field', param: 'mode' })] },
      { graph }
    );
    expect(plan.skipped[0].reason).toMatch(/select parameter/);
  });

  it('brings a value the control could not produce back inside its range', () => {
    // ComputeFieldMapper's scale is clamped to 0.1..5. A keyframe at 40 is a
    // slider pinned at one end for part of the piece, with nothing on screen
    // saying why.
    const plan = planArc(
      {
        durationSeconds: 30,
        moves: [
          move({
            nodeId: 'field',
            keyframes: [
              { atSeconds: 0, value: -3, ease: 'linear' },
              { atSeconds: 30, value: 40, ease: 'linear' },
            ],
          }),
        ],
      },
      { graph }
    );
    expect(plan.moves[0].keyframes.map((k) => k.value)).toEqual([0.1, 5]);
    expect(plan.clampedCount).toBe(2);
  });

  it('rounds an int parameter, because the editor will anyway', () => {
    const plan = planArc(
      {
        durationSeconds: 30,
        moves: [
          move({
            nodeId: 'field',
            param: 'resolution',
            keyframes: [
              { atSeconds: 0, value: 32.4, ease: 'linear' },
              { atSeconds: 30, value: 128.6, ease: 'linear' },
            ],
          }),
        ],
      },
      { graph }
    );
    expect(plan.moves[0].keyframes.map((k) => k.value)).toEqual([32, 129]);
  });

  it('says which moves would land on keyframes the artist made', () => {
    manager.addKeyframeAt('field', 'scale', 0, 1);
    manager.addKeyframeAt('field', 'scale', 5, 2);

    const plan = planArc({ durationSeconds: 30, moves: [move({ nodeId: 'field' })] }, {
      graph,
      timelineManager: manager,
    });
    expect(plan.moves[0].replaces).toBe(2);
    expect(plan.replacedCount).toBe(1);
  });

  it('writes the arc, its length and its loop, and starts the timeline', () => {
    const plan = planArc(
      {
        durationSeconds: 64,
        moves: [
          move({
            nodeId: 'field',
            keyframes: [
              { atSeconds: 0, value: 1, ease: 'ease-in-out' },
              { atSeconds: 32, value: 4, ease: 'ease-out' },
              { atSeconds: 64, value: 1, ease: 'linear' },
            ],
          }),
        ],
      },
      { graph, timelineManager: manager }
    );

    const written = applyArc(plan, { timelineManager: manager });

    expect(written.keyframes).toBe(3);
    expect(manager.getKeyframeCount('field', 'scale')).toBe(3);
    expect(manager.getDuration()).toBe(64);
    // A loop still set to the old length is what turns a bar-aligned arc back
    // into something that cannot be played in a set.
    expect(manager.getLoopEnd()).toBe(64);
    expect(manager.getLoop()).toBe(true);
    expect(manager.isEnabled()).toBe(true);
  });

  it('replaces a parameter\'s track outright rather than merging into it', () => {
    // Half the artist's keyframes under half the director's is an arrangement
    // neither of them wrote.
    manager.addKeyframeAt('field', 'scale', 1, 2);
    manager.addKeyframeAt('field', 'scale', 2, 3);
    manager.addKeyframeAt('field', 'scale', 3, 4);

    const plan = planArc({ durationSeconds: 30, moves: [move({ nodeId: 'field' })] }, {
      graph,
      timelineManager: manager,
    });
    applyArc(plan, { timelineManager: manager });

    expect(manager.getKeyframeCount('field', 'scale')).toBe(2);
  });

  it('leaves every track the arc did not name alone', () => {
    manager.addKeyframeAt('circle', 'radius', 0, 0.1);
    manager.addKeyframeAt('circle', 'radius', 4, 0.4);

    const plan = planArc({ durationSeconds: 30, moves: [move({ nodeId: 'field' })] }, {
      graph,
      timelineManager: manager,
    });
    applyArc(plan, { timelineManager: manager });

    expect(manager.getKeyframeCount('circle', 'radius')).toBe(2);
  });

  it('hands back the timeline it replaced, and can put it back', () => {
    manager.addKeyframeAt('circle', 'radius', 0, 0.1);
    manager.addKeyframeAt('circle', 'radius', 6, 0.5);
    manager.setDuration(6);

    const plan = planArc({ durationSeconds: 64, moves: [move({ nodeId: 'field' })] }, {
      graph,
      timelineManager: manager,
    });
    const { backup } = applyArc(plan, { timelineManager: manager });

    expect(manager.getKeyframeCount('field', 'scale')).toBe(2);

    revertArc(backup, { timelineManager: manager });

    expect(manager.getKeyframeCount('field', 'scale')).toBe(0);
    expect(manager.getKeyframeCount('circle', 'radius')).toBe(2);
    expect(manager.getDuration()).toBe(6);
    // Saying yes to an arc and changing your mind is not the same as having
    // been left with the timeline running over parameters you did not choose.
    expect(manager.isEnabled()).toBe(false);
  });
});

describe('the timing context the panel builds', () => {
  let manager;

  beforeEach(() => {
    window.NodeDefs = NodeDefs;
    manager = new TimelineManager({
      graph: { nodes: [{ id: 'circle', kind: 'Circle', params: { radius: 0.25 } }] },
      onChange: () => {},
    });
  });

  it('sends the length, the loop and what is already keyframed', () => {
    manager.setDuration(48);
    manager.addKeyframeAt('circle', 'radius', 0, 0.1);
    manager.addKeyframeAt('circle', 'radius', 8, 0.4);

    const timing = buildTimelineContext({ timelineManager: manager });

    expect(timing.durationSeconds).toBe(48);
    expect(timing.loop).toBe(true);
    expect(timing.tracks).toEqual([{ nodeId: 'circle', param: 'radius', keyframes: 2 }]);
  });

  it('sends a tempo only when the artist is performing to one', () => {
    // A BPM box sitting at its default in a panel nobody opened is not a tempo
    // anyone performs at, and an arc cut to bar lines at it is worse than one
    // that picks a round length.
    const off = buildTimelineContext({
      timelineManager: manager,
      vjPanel: { beatSyncEnabled: false, beatSyncManager: { bpm: 120, beatsPerMeasure: 4 } },
    });
    expect(off.bpm).toBeUndefined();

    const on = buildTimelineContext({
      timelineManager: manager,
      vjPanel: { beatSyncEnabled: true, beatSyncManager: { bpm: 128, beatsPerMeasure: 4 } },
    });
    expect(on.bpm).toBe(128);
    expect(on.beatsPerBar).toBe(4);
  });
});
