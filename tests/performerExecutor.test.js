// The executor: node resolution, the rules fence, drives and ramps.
//
// The editor below it is faked, but the two modules that actually write to a
// parameter and to the output are the real ones — those are where the
// interesting mistakes live.

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/performer/ActionExecutor.js';
import { normalizeAction } from '../src/performer/actions.js';
import { normalizeRules } from '../src/performer/Scenario.js';
import { SignalBus } from '../src/performer/SignalBus.js';
import { getMasterOpacity, resetOutputOpacity } from '../src/vj/MasterOutput.js';

function makeEditor(nodes = []) {
  return { graph: { nodes } };
}

function node(id, kind, extra = {}) {
  return { id, kind, params: {}, ...extra };
}

function makeExecutor(options = {}) {
  const executor = new ActionExecutor({
    editor: options.editor || makeEditor(options.nodes || []),
    ...options,
  });
  executor.rules = normalizeRules(options.rules || {});
  return executor;
}

const act = (raw) => normalizeAction(raw);

beforeEach(() => {
  resetOutputOpacity();
});

describe('resolveNode', () => {
  it('finds a node by id', () => {
    const executor = makeExecutor({ nodes: [node('7', 'Blur')] });
    expect(executor.resolveNode('7').id).toBe('7');
  });

  it('finds a node by the name the artist gave it', () => {
    const executor = makeExecutor({ nodes: [node('7', 'Blur', { name: 'hue drift' })] });
    expect(executor.resolveNode('hue drift').id).toBe('7');
  });

  it('falls back to the node kind, so a scenario works before anything is named', () => {
    const executor = makeExecutor({ nodes: [node('7', 'Blur')] });
    expect(executor.resolveNode('Blur').id).toBe('7');
    expect(executor.resolveNode('blur').id).toBe('7');
  });

  it('prefers an id over a name that collides with it', () => {
    const executor = makeExecutor({
      nodes: [node('7', 'Blur', { name: 'other' }), node('other', 'Warp')],
    });
    expect(executor.resolveNode('other').kind).toBe('Warp');
  });

  it('prefers a name over a kind', () => {
    const executor = makeExecutor({
      nodes: [node('1', 'Warp'), node('2', 'Blur', { name: 'Warp' })],
    });
    expect(executor.resolveNode('Warp').id).toBe('2');
  });

  it('returns nothing rather than guessing when there is no match', () => {
    const executor = makeExecutor({ nodes: [node('7', 'Blur')] });
    expect(executor.resolveNode('nothing')).toBeFalsy();
  });

  it('stops returning a cached node once it has left the graph', () => {
    const nodes = [node('7', 'Blur')];
    const executor = makeExecutor({ nodes });
    expect(executor.resolveNode('7')).toBeTruthy();

    nodes.length = 0;
    expect(executor.resolveNode('7')).toBeFalsy();
  });
});

describe('the rules fence', () => {
  it('refuses a scene change when scenes are off', () => {
    const executor = makeExecutor({ rules: { allowSceneChanges: false } });
    const result = executor.execute(act({ type: 'scene', scene: 'x' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/allowSceneChanges/);
  });

  it('refuses a graph edit unless the scenario asked for one', () => {
    const executor = makeExecutor({});
    const result = executor.execute(act({ type: 'graph', patch: { nodes: [] } }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/allowGraphEdits/);
  });

  it('holds a second scene change back until the cooldown has passed', () => {
    const scene = { id: 's1', name: 'One', data: {} };
    const sceneManager = {
      getScene: (id) => (id === 's1' ? scene : null),
      getAllScenes: () => [scene],
      switchToScene: () => Promise.resolve(true),
    };
    const executor = makeExecutor({ sceneManager, rules: { minSceneChangeSeconds: 10 } });

    const first = executor.execute(act({ type: 'scene', scene: 's1' }), { now: 1000 });
    expect(first.ok).toBe(true);

    executor.sceneChangeInFlight = false;
    const second = executor.execute(act({ type: 'scene', scene: 's1' }), { now: 3000 });
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/minSceneChangeSeconds/);

    const third = executor.execute(act({ type: 'scene', scene: 's1' }), { now: 20_000 });
    expect(third.ok).toBe(true);
  });

  it('refuses a scene change while one is still loading', () => {
    const scene = { id: 's1', name: 'One', data: {} };
    const executor = makeExecutor({
      sceneManager: {
        getScene: () => scene,
        getAllScenes: () => [scene],
        switchToScene: () => new Promise(() => {}),
      },
      rules: { minSceneChangeSeconds: 0 },
    });
    expect(executor.execute(act({ type: 'scene', scene: 's1' }), { now: 1 }).ok).toBe(true);
    expect(executor.execute(act({ type: 'scene', scene: 's1' }), { now: 2 }).ok).toBe(false);
  });

  it('spends nothing from the budget on an action it refused', () => {
    const executor = makeExecutor({ rules: { allowSceneChanges: false } });
    expect(executor.execute(act({ type: 'scene', scene: 'x' })).cost).toBe(0);
  });

  it('does not let a thrown verb take the set down', () => {
    const executor = makeExecutor({});
    executor.doMaster = () => { throw new Error('boom'); };
    const result = executor.execute(act({ type: 'master', to: 1 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/boom/);
  });
});

describe('the master fader', () => {
  it('holds to the scenario ceiling', () => {
    const executor = makeExecutor({ rules: { masterCeiling: 0.6 } });
    executor.execute(act({ type: 'master', to: 1 }));
    expect(getMasterOpacity()).toBeCloseTo(0.6, 3);
  });

  it('holds to the floor, so an over-eager fade cannot read as a dead output', () => {
    const executor = makeExecutor({ rules: { masterFloor: 0.2 } });
    executor.execute(act({ type: 'master', to: 0 }));
    expect(getMasterOpacity()).toBeCloseTo(0.2, 3);
  });

  it('lets a blackout past the floor, because that is what a blackout is for', () => {
    const executor = makeExecutor({ rules: { masterFloor: 0.2 } });
    executor.execute(act({ type: 'blackout', on: true }));
    expect(getMasterOpacity()).toBe(0);
  });

  it('puts the output back where it was after a blackout', () => {
    const executor = makeExecutor({});
    executor.execute(act({ type: 'master', to: 0.4 }));
    executor.execute(act({ type: 'blackout', on: true }));
    expect(getMasterOpacity()).toBe(0);

    executor.execute(act({ type: 'blackout', on: false }));
    expect(getMasterOpacity()).toBeCloseTo(0.4, 3);
  });

  it('lifts a blackout when the fader is deliberately moved up', () => {
    const executor = makeExecutor({});
    executor.execute(act({ type: 'blackout', on: true }));
    executor.execute(act({ type: 'master', to: 1 }));
    expect(executor.blackedOut).toBe(false);
    expect(getMasterOpacity()).toBe(1);
  });

  it('fades the fader over time rather than jumping', () => {
    const executor = makeExecutor({});
    executor.execute(act({ type: 'master', to: 1 }));
    executor.execute(act({ type: 'master', to: 0, overSeconds: 1 }));

    executor.tick(0.5, null);
    expect(getMasterOpacity()).toBeGreaterThan(0.3);
    expect(getMasterOpacity()).toBeLessThan(0.7);

    executor.tick(0.6, null);
    expect(getMasterOpacity()).toBeCloseTo(0, 3);
  });
});

describe('drives', () => {
  function driveRig() {
    const target = node('1', 'Warp');
    const executor = makeExecutor({ nodes: [target] });
    const bus = new SignalBus({});
    bus.value = (name) => (name === 'bass' ? bus._fake ?? 0 : 0);
    return { executor, bus, target };
  }

  it('maps a signal onto the parameter\'s declared range', () => {
    const { executor, bus, target } = driveRig();
    executor.execute(act({ type: 'drive', signal: 'bass', node: '1', param: 'amount', min: 2, max: 4 }));

    bus._fake = 0.5;
    executor.tick(1 / 60, bus);
    expect(target.params.amount).toBeCloseTo(3, 3);

    bus._fake = 1;
    executor.tick(1 / 60, bus);
    expect(target.params.amount).toBeCloseTo(4, 3);
  });

  it('inverts when asked', () => {
    const { executor, bus, target } = driveRig();
    executor.execute(act({
      type: 'drive', signal: 'bass', node: '1', param: 'amount', min: 0, max: 1, invert: true,
    }));
    bus._fake = 1;
    executor.tick(1 / 60, bus);
    expect(target.params.amount).toBeCloseTo(0, 3);
  });

  it('leaves a parameter holding an expression alone', () => {
    const target = node('1', 'Warp', { params: { amount: '=osc * 2' } });
    const executor = makeExecutor({ nodes: [target] });
    const bus = new SignalBus({});
    bus.value = () => 1;

    executor.execute(act({ type: 'drive', signal: 'bass', node: '1', param: 'amount', min: 0, max: 5 }));
    executor.tick(1 / 60, bus);
    // The formula owns the parameter; the reading reaches it as `osc`.
    expect(target.params.amount).toBe('=osc * 2');
  });

  it('drops a drive and a ramp together when the same parameter is claimed twice', () => {
    const { executor } = driveRig();
    executor.execute(act({ type: 'param', node: '1', param: 'amount', to: 9, overSeconds: 10 }));
    expect(executor.ramps.size).toBe(1);

    executor.execute(act({ type: 'drive', signal: 'bass', node: '1', param: 'amount' }));
    expect(executor.ramps.size).toBe(0);
    expect(executor.drives.size).toBe(1);
  });

  it('releases one parameter without disturbing its siblings', () => {
    const { executor } = driveRig();
    executor.execute(act({ type: 'drive', signal: 'bass', node: '1', param: 'a' }));
    executor.execute(act({ type: 'drive', signal: 'bass', node: '1', param: 'b' }));
    executor.execute(act({ type: 'undrive', node: '1', param: 'a' }));
    expect(executor.drives.size).toBe(1);
  });

  it('keeps the master fade running when a section releases its drives', () => {
    const { executor } = driveRig();
    executor.execute(act({ type: 'drive', signal: 'bass', node: '1', param: 'a' }));
    executor.execute(act({ type: 'master', to: 0, overSeconds: 5 }));

    executor.clearDrives();
    expect(executor.drives.size).toBe(0);
    expect(executor.ramps.has('__master')).toBe(true);
  });
});

describe('ramps', () => {
  it('moves a parameter from where it is to where it was told, over bars', () => {
    const target = node('1', 'Warp', { params: { speed: 1 } });
    const executor = makeExecutor({ nodes: [target] });

    executor.execute(act({ type: 'param', node: '1', param: 'speed', to: 3, overBars: 2 }),
      { secondsPerBar: 2 });

    executor.tick(2, null); // half of four seconds
    expect(target.params.speed).toBeCloseTo(2, 1);

    executor.tick(2.1, null);
    expect(target.params.speed).toBeCloseTo(3, 3);
    expect(executor.ramps.size).toBe(0);
  });

  it('writes the value at once when no time was given', () => {
    const target = node('1', 'Warp', { params: { speed: 1 } });
    const executor = makeExecutor({ nodes: [target] });
    executor.execute(act({ type: 'param', node: '1', param: 'speed', to: 3 }));
    expect(target.params.speed).toBe(3);
  });

  it('drops a ramp whose node went away with a scene change', () => {
    const nodes = [node('1', 'Warp', { params: { speed: 1 } })];
    const executor = makeExecutor({ nodes });
    executor.execute(act({ type: 'param', node: '1', param: 'speed', to: 3, overSeconds: 10 }));

    nodes.length = 0;
    executor.tick(1, null);
    expect(executor.ramps.size).toBe(0);
  });
});

describe('failures that are not crashes', () => {
  it('says which scene it could not find', () => {
    const executor = makeExecutor({ sceneManager: { getScene: () => null, getAllScenes: () => [] } });
    expect(executor.execute(act({ type: 'scene', scene: 'ghost' })).reason).toMatch(/ghost/);
  });

  it('says which node it could not find', () => {
    const executor = makeExecutor({ nodes: [] });
    expect(executor.execute(act({ type: 'param', node: 'ghost', param: 'x', to: 1 })).reason)
      .toMatch(/ghost/);
  });

  it('sends section and cue back to the engine rather than swallowing them', () => {
    const executor = makeExecutor({});
    expect(executor.execute(act({ type: 'section', to: 'x' })).ok).toBe(false);
    expect(executor.execute(act({ type: 'cue', name: 'x' })).ok).toBe(false);
  });
});
