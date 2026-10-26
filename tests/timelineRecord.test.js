// Record mode and keyframe interpolation.
//
// Recording turns the artist's edits into keyframes: a value moved while the timeline plays is
// sampled onto a 0.1 s grid, and one typed while it is paused lands on the playhead. A whole pass
// is one undo step. The keyframe menu sets how each keyframe eases into the next.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TimelineManager } from '../src/core/TimelineManager.js';

function makeEditor() {
  const circle = { id: '2', kind: 'Circle', params: { radius: 0.2 } };
  const actions = [];
  const listeners = {};
  return {
    graph: { nodes: [circle] },
    circle,
    actions,
    paramPanel: { selectedNode: circle, renderParameters: () => {} },
    undoManager: { recordAction: (a) => actions.push(a) },
    eventSystem: {
      on: (name, fn) => { listeners[name] = fn; },
      emit: (name, data) => listeners[name]?.(data),
    },
    onChange: () => {},
  };
}

function play(manager, seconds, step = 1 / 60, each = () => {}) {
  for (let t = 0; t < seconds; t += step) {
    each(t);
    manager.update(step);
  }
}

describe('timeline record mode', () => {
  let editor;
  let manager;

  beforeEach(() => {
    globalThis.NodeDefs = {
      Circle: { params: [{ name: 'radius', type: 'float' }, { name: 'smoothness', type: 'float' }] },
    };
    editor = makeEditor();
    manager = new TimelineManager(editor);
  });

  afterEach(() => {
    delete globalThis.NodeDefs;
  });

  it('arming record switches the timeline on', () => {
    manager.setRecording(true);
    expect(manager.isEnabled()).toBe(true);
    expect(manager.isRecording()).toBe(true);
  });

  it('records a value moved during playback as keyframes on a 0.1 s grid', () => {
    manager.setRecording(true);
    manager.play();
    // A drag writes strings into node.params, every frame.
    play(manager, 1, 1 / 60, (t) => { editor.circle.params.radius = (0.2 + t * 0.3).toFixed(3); });

    const track = manager.timeline.findTrack('2', 'radius');
    expect(track.keyframes.length).toBeGreaterThan(5);
    expect(track.keyframes.length).toBeLessThanOrEqual(11);
    for (const kf of track.keyframes) {
      expect(Math.abs(kf.time * 10 - Math.round(kf.time * 10))).toBeLessThan(1e-6);
    }
    expect(track.keyframes.at(-1).value).toBeGreaterThan(0.45);
  });

  it('does not snap a value being recorded back to the curve', () => {
    manager.timeline.addTrack('2', 'radius', 'float');
    manager.timeline.addKeyframe('2', 'radius', 0, 0.2);
    manager.timeline.addKeyframe('2', 'radius', 2, 0.2);
    manager.setRecording(true);
    manager.play();

    play(manager, 0.5, 1 / 60, () => { editor.circle.params.radius = '0.600'; });
    expect(Number(editor.circle.params.radius)).toBeCloseTo(0.6);
  });

  it('writes a committed edit at the playhead while paused', () => {
    manager.setRecording(true);
    manager.setCurrentTime(2.5);
    editor.circle.params.radius = 0.45;
    editor.eventSystem.emit('PARAMETER_CHANGED', {
      node: editor.circle, parameterName: 'radius', newValue: 0.45, source: 'user',
    });

    expect(manager.timeline.getKeyframeAt('2', 'radius', 2.5)?.value).toBe(0.45);
  });

  it('ignores edits while not recording, and expressions while recording', () => {
    const changed = (newValue) => editor.eventSystem.emit('PARAMETER_CHANGED', {
      node: editor.circle, parameterName: 'radius', newValue, source: 'user',
    });
    manager.enable();
    changed(0.4);
    expect(manager.hasKeyframes('2', 'radius')).toBeFalsy();

    manager.setRecording(true);
    changed('=sin(time)');
    expect(manager.hasKeyframes('2', 'radius')).toBeFalsy();
  });

  it('undoes a whole recording pass in one step', () => {
    manager.setRecording(true);
    manager.play();
    play(manager, 1, 1 / 60, (t) => { editor.circle.params.radius = 0.2 + t * 0.3; });
    manager.setRecording(false);

    const passes = editor.actions.filter((a) => a.type === 'RECORD_KEYFRAMES');
    expect(passes).toHaveLength(1);

    passes[0].undo();
    expect(manager.hasKeyframes('2', 'radius')).toBeFalsy();
    passes[0].redo();
    expect(manager.getKeyframeCount('2', 'radius')).toBeGreaterThan(5);
  });

  it('keeps a keyframe\'s easing when recording over it', () => {
    manager.timeline.addTrack('2', 'radius', 'float');
    manager.timeline.addKeyframe('2', 'radius', 1, 0.3, 'ease-in-out');
    manager.setRecording(true);
    manager.setCurrentTime(1);
    manager.recordParameterChange('2', 'radius', 0.5);

    const kf = manager.timeline.getKeyframeAt('2', 'radius', 1);
    expect(kf.value).toBe(0.5);
    expect(kf.interpolation).toBe('ease-in-out');
  });
});

describe('keyframing a control only the parameter panel defines', () => {
  // The panel shows the Circle's Softness as `epsilon`, which no node definition lists.
  beforeEach(() => {
    globalThis.NodeDefs = { Circle: { params: [{ name: 'radius', type: 'float' }] } };
  });

  afterEach(() => {
    delete globalThis.NodeDefs;
  });

  it('keyframes a number as a float instead of refusing it', () => {
    const editor = makeEditor();
    editor.circle.params.epsilon = 0.02;
    const manager = new TimelineManager(editor);

    manager.addKeyframe('2', 'epsilon', 0.02);
    manager.setCurrentTime(2);
    manager.addKeyframe('2', 'epsilon', 0.3);

    expect(manager.timeline.findTrack('2', 'epsilon').paramType).toBe('float');
    expect(manager.getKeyframeCount('2', 'epsilon')).toBe(2);
  });

  it('still refuses a parameter that is not a number', () => {
    const editor = makeEditor();
    const manager = new TimelineManager(editor);
    expect(() => manager.addKeyframe('2', 'missing', 'text')).toThrow(/not found/);
  });
});

describe('keyframe interpolation', () => {
  let editor;
  let manager;

  beforeEach(() => {
    editor = makeEditor();
    manager = new TimelineManager(editor);
    manager.timeline.addTrack('2', 'radius', 'float');
    manager.timeline.addKeyframe('2', 'radius', 0, 0);
    manager.timeline.addKeyframe('2', 'radius', 2, 1);
    manager.enable();
  });

  const valueAt = (t) => {
    manager.setCurrentTime(t);
    return editor.circle.params.radius;
  };

  it('changes how the segment after a keyframe eases', () => {
    expect(valueAt(0.5)).toBeCloseTo(0.25);

    manager.setKeyframeInterpolation('2', 'radius', 0, 'ease-in');
    expect(valueAt(0.5)).toBeLessThan(0.1);

    manager.setKeyframeInterpolation('2', 'radius', 0, 'ease-out');
    expect(valueAt(0.5)).toBeGreaterThan(0.5);

    manager.setKeyframeInterpolation('2', 'radius', 0, 'step');
    expect(valueAt(1.9)).toBe(0);
    expect(valueAt(2)).toBe(1);
  });

  it('is undoable', () => {
    manager.setKeyframeInterpolation('2', 'radius', 0, 'step');
    const action = editor.actions.at(-1);
    expect(action.type).toBe('SET_KEYFRAME_INTERPOLATION');

    action.undo();
    expect(manager.timeline.getKeyframeAt('2', 'radius', 0).interpolation).toBe('linear');
    action.redo();
    expect(manager.timeline.getKeyframeAt('2', 'radius', 0).interpolation).toBe('step');
  });
});
