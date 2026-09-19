// The executor: node resolution, the rules fence, drives and ramps.
//
// The editor below it is faked, but the two modules that actually write to a
// parameter and to the output are the real ones — those are where the
// interesting mistakes live.

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/performer/ActionExecutor.js';
import { describeAction, normalizeAction } from '../src/performer/actions.js';
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

// One set's log, four verbs, one fault: every field the live schema did not
// name arrived missing, and each verb's default turned that into something
// nobody asked for. A `param` with no `to` went to zero (its `why` said "raise
// gently to 0.18 over 30 seconds"), a `master` with no level jumped to full
// ("restore smoothly, keeping the lift restrained"), and a `blackout` with no
// `on` killed the output ("clear the kill immediately; the artist has asked
// for brightness"). The schema names them now; these are what happens when one
// goes missing anyway.
describe('an action whose value never arrived', () => {
  it('refuses a param move rather than writing a zero', () => {
    const target = node('1', 'Grade', { params: { valueMult: 0.4 } });
    const executor = makeExecutor({ nodes: [target] });

    const result = executor.execute(act({
      type: 'param', node: '1', param: 'valueMult',
      why: 'Raise gently to 0.18 over 30 seconds.',
    }));

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/value/);
    expect(target.params.valueMult).toBe(0.4);
  });

  it('refuses a param move whose value is not a number', () => {
    const target = node('1', 'Grade', { params: { valueMult: 0.4 } });
    const executor = makeExecutor({ nodes: [target] });

    expect(executor.execute(act({ type: 'param', node: '1', param: 'valueMult', to: '18%' })).ok)
      .toBe(false);
    expect(target.params.valueMult).toBe(0.4);
  });

  it('still plays a deliberate zero', () => {
    const target = node('1', 'Grade', { params: { valueMult: 0.4 } });
    const executor = makeExecutor({ nodes: [target] });

    expect(executor.execute(act({ type: 'param', node: '1', param: 'valueMult', to: 0 })).ok)
      .toBe(true);
    expect(target.params.valueMult).toBe(0);
  });

  it('reads a value from the other names a model reaches for', () => {
    const target = node('1', 'Grade', { params: { valueMult: 0 } });
    const executor = makeExecutor({ nodes: [target] });

    executor.execute(act({ type: 'param', node: '1', param: 'valueMult', value: 0.18 }));
    expect(target.params.valueMult).toBeCloseTo(0.18, 5);

    executor.execute(act({ type: 'param', node: '1', param: 'valueMult', amount: '0.25' }));
    expect(target.params.valueMult).toBeCloseTo(0.25, 5);
  });

  it('finds the value inside the same nested target the name comes from', () => {
    const target = node('1', 'Grade', { params: { valueMult: 0 } });
    const executor = makeExecutor({ nodes: [target] });

    // parameterTarget() reads `target` as the node and the parameter, so a
    // plan that nests the whole move there must not lose its number on the way.
    executor.execute(act({ type: 'param', target: { node: '1', param: 'valueMult', to: 0.3 } }));
    expect(target.params.valueMult).toBeCloseTo(0.3, 5);
  });

  it('takes a fade length sent under another name rather than landing at once', () => {
    const target = node('1', 'Grade', { params: { valueMult: 0 } });
    const executor = makeExecutor({ nodes: [target] });

    executor.execute(act({ type: 'param', node: '1', param: 'valueMult', to: 0.2, seconds: 30 }));
    expect(target.params.valueMult).toBe(0);
    expect(executor.ramps.size).toBe(1);

    executor.tick(15, null);
    expect(target.params.valueMult).toBeCloseTo(0.1, 2);
  });

  it('refuses a master move rather than jumping the fader to the top', () => {
    const executor = makeExecutor({});
    executor.execute(act({ type: 'master', to: 0.3 }));

    const result = executor.execute(act({ type: 'master', why: 'Restore smoothly, restrained.' }));
    expect(result.ok).toBe(false);
    expect(getMasterOpacity()).toBeCloseTo(0.3, 3);
  });

  it('refuses a speed change with no speed in it', () => {
    const executor = makeExecutor({});
    expect(executor.execute(act({ type: 'speed', why: 'Ease it back.' })).ok).toBe(false);
  });

  it('refuses a blackout that does not say which way it goes', () => {
    const executor = makeExecutor({});
    executor.execute(act({ type: 'master', to: 0.5 }));

    const result = executor.execute(act({ type: 'blackout', why: 'Clear the kill immediately.' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/on/);
    // The output is where it was: not killed, and not restored either.
    expect(getMasterOpacity()).toBeCloseTo(0.5, 3);
    expect(executor.blackedOut).toBe(false);
  });

  it('still kills and restores when the action says which', () => {
    const executor = makeExecutor({});
    executor.execute(act({ type: 'master', to: 0.5 }));
    executor.execute(act({ type: 'blackout', on: true }));
    expect(getMasterOpacity()).toBe(0);

    executor.execute(act({ type: 'blackout', on: false }));
    expect(getMasterOpacity()).toBeCloseTo(0.5, 3);
  });
});

// A drive is the one action that is accepted without its node existing: the
// section that installs it is cutting to the look it belongs to in the same
// frame, and that look is still loading. What it must never do is stay that
// way in silence — a set whose drives are bound to nodes that are not in the
// patch runs with no errors in the log and barely moves on stage.
describe('a drive that never finds its node', () => {
  function rig(nodes = []) {
    const executor = makeExecutor({ nodes });
    const logged = [];
    executor.log = (level, message) => logged.push({ level, message });
    const bus = new SignalBus({});
    bus.value = () => 0.5;
    return { executor, bus, logged };
  }

  const install = (executor) => executor.execute(act({
    type: 'drive', signal: 'low', node: 'ComputeNoise', param: 'scale', min: 0, max: 1,
  }));

  it('is still accepted, because the look it belongs to may still be loading', () => {
    const { executor } = rig();
    expect(install(executor).ok).toBe(true);
  });

  it('says so once, after the grace period, instead of failing every frame', () => {
    const { executor, bus, logged } = rig();
    install(executor);

    // Inside the grace period: nothing said yet.
    executor.tick(1, bus);
    expect(logged).toHaveLength(0);

    executor.tick(1.5, bus);
    expect(logged).toHaveLength(1);
    expect(logged[0].level).toBe('warn');
    expect(logged[0].message).toContain('no node "ComputeNoise"');

    // And not again, at sixty frames a second, for the rest of the night.
    for (let i = 0; i < 120; i += 1) executor.tick(1 / 60, bus);
    expect(logged).toHaveLength(1);
  });

  it('does not start the clock while the scene it belongs to is still loading', () => {
    const { executor, bus, logged } = rig();
    install(executor);
    executor.sceneChangeInFlight = true;

    for (let i = 0; i < 20; i += 1) executor.tick(1, bus);
    expect(logged).toHaveLength(0);
  });

  it('says when it finds its node after all, because the warning was alarming', () => {
    const { executor, bus, logged, } = rig();
    install(executor);
    executor.tick(3, bus);
    expect(logged).toHaveLength(1);

    // The look finally lands, carrying the node the drive was written for.
    executor.editor.graph.nodes.push(node('9', 'ComputeNoise'));
    executor.invalidateNodes();
    executor.tick(1 / 60, bus);

    expect(logged).toHaveLength(2);
    expect(logged[1].message).toContain('driving again');
    expect(executor.editor.graph.nodes[0].params.scale).toBeCloseTo(0.5, 3);
  });

  it('shows in the panel status as unbound, so a dead drive does not read as a live one', () => {
    const { executor, bus } = rig();
    install(executor);
    expect(executor.status().drives[0].bound).toBe(true);

    executor.tick(3, bus);
    expect(executor.status().drives[0].bound).toBe(false);
  });
});

describe('describePatch', () => {
  it('names each node the way a scenario has to write it', () => {
    const executor = makeExecutor({
      nodes: [
        node('1', 'ComputeNoise', { params: { scale: 1, speed: 0.2 } }),
        node('2', 'Blur', { name: 'hue drift', params: { amount: 0.5 } }),
      ],
    });

    expect(executor.describePatch()).toEqual([
      { node: 'ComputeNoise', kind: 'ComputeNoise', params: ['scale', 'speed'] },
      { node: 'hue drift', kind: 'Blur', params: ['amount'] },
    ]);
  });

  it('is bounded, because this goes into a prompt every time the director is asked', () => {
    const nodes = Array.from({ length: 80 }, (_, i) => node(String(i), 'Blur'));
    const executor = makeExecutor({ nodes });
    expect(executor.describePatch({ maxNodes: 40 })).toHaveLength(40);
  });

  it('notices a project load, which replaces the node array', () => {
    const executor = makeExecutor({ nodes: [node('1', 'Blur')] });
    expect(executor.describePatch()[0].kind).toBe('Blur');

    executor.editor.graph.nodes = [node('2', 'Warp')];
    expect(executor.describePatch()[0].kind).toBe('Warp');
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

describe('installPatchAsScene', () => {
  // How a generated look becomes something a section can cut to. The real
  // SceneManager, because what is under test is that the scene it stores is
  // one switchToScene() can actually load.

  const patch = () => ({
    nodes: [
      { id: 'a', kind: 'Noise', x: 0, y: 0, params: { scale: 3 }, name: 'fog density' },
      { id: 'b', kind: 'OutputFinal', x: 270, y: 0, params: {} },
    ],
    connections: [{ from: { nodeId: 'a', pin: 0 }, to: { nodeId: 'b', pin: 0 } }],
  });

  function makeSceneManager() {
    const scenes = new Map();
    const order = [];
    return {
      scenes,
      addScene(id, data, name) {
        const scene = { id, name, data, notes: '' };
        scenes.set(id, scene);
        order.push(id);
        return scene;
      },
      getScene: (id) => scenes.get(id),
      getAllScenes: () => order.map((id) => scenes.get(id)),
      updateSceneMetadata(id, meta) {
        const scene = scenes.get(id);
        if (scene && meta.notes !== undefined) scene.notes = meta.notes;
        return Boolean(scene);
      },
    };
  }

  /** The real conversion, as main.js injects it. */
  const convert = (p, { title }) => ({
    app: 'Rhizomium-Web',
    format: 'rhizomium-project',
    nodes: p.nodes.map((n) => ({ id: n.id, kind: n.kind, position: { x: n.x, y: n.y }, params: n.params })),
    connections: p.connections,
    ...(title ? { metadata: { name: title } } : {}),
  });

  function makeInstaller(overrides = {}) {
    return makeExecutor({
      sceneManager: makeSceneManager(),
      patchToProjectData: convert,
      ...overrides,
    });
  }

  it('stores the patch as a scene under the name the scenario will use', () => {
    const executor = makeInstaller();
    const scene = executor.installPatchAsScene('Opening', patch(), { notes: 'cold and slow' });

    expect(scene.name).toBe('Opening');
    // Named, so the scenario's own lookup finds it.
    expect(executor.resolveScene('Opening').id).toBe(scene.id);
    expect(executor.resolveScene('Opening').notes).toBe('cold and slow');
  });

  it('stores project data, not a patch — a scene is loaded, never applied', () => {
    const executor = makeInstaller();
    const { id } = executor.installPatchAsScene('Opening', patch());
    const { data } = executor.sceneManager.getScene(id);

    expect(data.format).toBe('rhizomium-project');
    expect(data.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(data.connections).toHaveLength(1);
  });

  it('replaces a look of the same name rather than leaving "Drop" and "Drop 2"', () => {
    // A build re-run after one look came out wrong should replace that look.
    // Two scenes with one name is a scenario naming whichever it finds first.
    const executor = makeInstaller();
    const first = executor.installPatchAsScene('Drop', patch());
    const again = executor.installPatchAsScene('Drop', {
      nodes: [{ id: 'c', kind: 'OutputFinal', x: 0, y: 0, params: {} }],
      connections: [],
    });

    expect(again.id).toBe(first.id);
    expect(executor.sceneManager.getAllScenes()).toHaveLength(1);
    expect(executor.sceneManager.getScene(first.id).data.nodes).toHaveLength(1);
  });

  it('carries a look\'s media into the scene, so the scene is not black when cut to', () => {
    // The clips travel in the scene's project data, in the shape a saved
    // project's textures are, because that is what the ordinary loader
    // restores. Anywhere else and the first thing that cuts to this look shows
    // a texture node pointing at nothing.
    const executor = makeInstaller();
    const textures = { a: { filename: 'fog-loop.mp4', dataUrl: 'data:video/mp4;base64,AA==', isVideo: true } };
    const { id } = executor.installPatchAsScene('Opening', patch(), { textures });

    expect(executor.sceneManager.getScene(id).data.textures).toEqual(textures);
  });

  it('leaves the scene data alone for a look with no media in it', () => {
    const executor = makeInstaller();
    const { id } = executor.installPatchAsScene('Opening', patch(), { textures: {} });
    expect(executor.sceneManager.getScene(id).data.textures).toBeUndefined();
  });

  it('replaces a look\'s media along with its patch', () => {
    const executor = makeInstaller();
    const first = executor.installPatchAsScene('Drop', patch(), {
      textures: { a: { filename: 'old.png', dataUrl: 'data:image/png;base64,AA==' } },
    });
    executor.installPatchAsScene('Drop', patch(), {
      textures: { a: { filename: 'new.png', dataUrl: 'data:image/png;base64,BB==' } },
    });

    expect(executor.sceneManager.getScene(first.id).data.textures.a.filename).toBe('new.png');
  });

  it('gives the scene the look\'s own length, and a timeline set to it', () => {
    // A scene IS a project: loading one restores whatever timeline it carries.
    // A generated patch carried none, so every look was a ten-second scene in
    // the VJ panel's list and cutting to one left the timeline exactly as the
    // look before it had it.
    const executor = makeInstaller();
    const { id } = executor.installPatchAsScene('Opening', patch(), { holdSeconds: 48 });
    const { data } = executor.sceneManager.getScene(id);

    expect(data.timeline.enabled).toBe(true);
    expect(data.timeline.timeline.duration).toBe(48);
    expect(data.timeline.timeline.loopEnd).toBe(48);
    // Nothing generated has keyframes, and an empty list is still the right
    // thing to write: it says "this look animates from its own graph" rather
    // than leaving the last scene's tracks pointing at ids this patch lacks.
    expect(data.timeline.timeline.tracks).toEqual([]);
  });

  it('writes no timeline for a look the manifest gave no length', () => {
    const executor = makeInstaller();
    const { id } = executor.installPatchAsScene('Opening', patch(), {});
    expect(executor.sceneManager.getScene(id).data.timeline).toBeUndefined();
  });

  it('refuses an empty patch rather than installing a scene that renders nothing', () => {
    const executor = makeInstaller();
    expect(() => executor.installPatchAsScene('Nothing', { nodes: [], connections: [] }))
      .toThrow(/no nodes/);
  });

  it('says where the looks would have gone when there is no scene manager', () => {
    const executor = makeExecutor({ patchToProjectData: convert });
    expect(() => executor.installPatchAsScene('Opening', patch())).toThrow(/scene manager/);
  });
});

// --------------------------------------------------------------------------
// The set's own sound, and the editor's timeline.
//
// Both are things the performer now drives that it used to leave alone: a show
// folder can carry the bed a look was written to, and a section has a length
// the transport in front of the artist should be showing. Neither is faked at
// the level that matters — the deck below is the same five calls
// src/audio/audioDeck.js exposes, and the timeline is the real manager's
// interface, so what is asserted here is what the editor is asked to do.
// --------------------------------------------------------------------------

function fakeDeck(overrides = {}) {
  const deck = {
    calls: [],
    state: { file: '', loaded: false, playing: false, live: null, position: 0 },
    describe: () => deck.state,
    load: async (file, name) => {
      deck.calls.push(`load:${name}`);
      deck.state = { ...deck.state, file: name, loaded: true, position: 0 };
      return deck.state;
    },
    play: async () => {
      deck.calls.push('play');
      deck.state = { ...deck.state, playing: true };
      return { ok: true };
    },
    pause: () => { deck.calls.push('pause'); deck.state = { ...deck.state, playing: false }; },
    stop: () => { deck.calls.push('stop'); deck.state = { ...deck.state, playing: false, position: 0 }; },
    seek: (seconds) => { deck.calls.push(`seek:${seconds}`); deck.state = { ...deck.state, position: seconds }; },
    ...overrides,
  };
  return deck;
}

const sound = (name, path = name) => ({
  path, name, label: name.replace(/\.[^.]+$/, ''), kind: 'audio', size: 1024, file: { name },
});

const audioAction = (raw) => normalizeAction({ type: 'audio', ...raw });

/**
 * Let the half of an audio action that waits finish.
 *
 * doAudio() returns straight away — it runs inside a frame during a show — and
 * decodes and starts the track on its own time, exactly as doScene() loads a
 * scene. A test that asserted on the calls without this would be asserting on
 * the frame, not on the outcome.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the audio action, as a document', () => {
  it('plays by default, because that is what a section entering its bed means', () => {
    expect(audioAction({ clip: 'music.mp3' })).toMatchObject({
      clip: 'music.mp3', transport: 'play', seek: null,
    });
  });

  it('takes the words the Audio panel\'s own buttons use', () => {
    expect(audioAction({ transport: 'pause' }).transport).toBe('pause');
    expect(audioAction({ do: 'stop' }).transport).toBe('stop');
    // A verb nothing here does is the commonest thing a model invents.
    expect(audioAction({ transport: 'rewind' }).transport).toBe('play');
  });

  it('reads the clip under any of the names somebody would write it', () => {
    expect(audioAction({ sound: 'a.mp3' }).clip).toBe('a.mp3');
    expect(audioAction({ file: 'b.mp3' }).clip).toBe('b.mp3');
    expect(audioAction({ track: 'c.mp3' }).clip).toBe('c.mp3');
  });

  it('keeps "no position given" distinguishable from "start at zero"', () => {
    expect(audioAction({ clip: 'a.mp3' }).seek).toBeNull();
    expect(audioAction({ clip: 'a.mp3', seek: 0 }).seek).toBe(0);
    expect(audioAction({ clip: 'a.mp3', seek: 12.5 }).seek).toBe(12.5);
  });

  it('reads as one line in the log', () => {
    expect(describeAction(audioAction({ clip: 'music.mp3' }))).toBe('play music.mp3');
    expect(describeAction(audioAction({ transport: 'stop' }))).toBe('stop the bed');
  });
});

describe('the set\'s own sound', () => {
  function makePlayer(items = [sound('music.mp3', 'media/music.mp3')], overrides = {}) {
    const deck = fakeDeck(overrides.deck);
    const executor = makeExecutor({ audioDeck: deck, ...overrides });
    executor.setSounds(items);
    return { executor, deck };
  }

  it('takes only the audio out of a folder it is handed whole', () => {
    const { executor } = makePlayer();
    executor.setSounds([
      { path: 'media/fog.mp4', name: 'fog.mp4', kind: 'video' },
      sound('set.wav'),
    ]);
    expect(executor.sounds.map((item) => item.name)).toEqual(['set.wav']);
  });

  it('loads the bed and starts it at the top', async () => {
    const { executor, deck } = makePlayer();
    const result = executor.execute(audioAction({ clip: 'music.mp3' }));

    expect(result.ok).toBe(true);
    await flush();
    // At the top, because that is what makes a section and its bed the same
    // length: the hold was measured from this file.
    expect(deck.calls).toEqual(['load:music.mp3', 'seek:0', 'play']);
  });

  it('does not decode the same bed again when a section re-enters', async () => {
    const { executor, deck } = makePlayer();
    executor.execute(audioAction({ clip: 'music.mp3' }));
    await flush();
    deck.calls.length = 0;

    executor.execute(audioAction({ clip: 'music.mp3' }));
    await flush();
    expect(deck.calls).toEqual(['seek:0', 'play']);
  });

  it('refuses a name nothing in the folder answers to, where the panel can show it', () => {
    const { executor, deck } = makePlayer();
    const result = executor.execute(audioAction({ clip: 'nothing.mp3' }));

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no sound in the folder called "nothing.mp3"/);
    expect(deck.calls).toEqual([]);
  });

  it('says there is no folder open rather than naming a file nobody chose', () => {
    const { executor } = makePlayer([]);
    expect(executor.execute(audioAction({ clip: 'music.mp3' })).reason).toMatch(/no show folder is open/);
  });

  it('pauses and stops without touching the file', () => {
    const { executor, deck } = makePlayer();
    expect(executor.execute(audioAction({ transport: 'pause' })).ok).toBe(true);
    expect(executor.execute(audioAction({ transport: 'stop' })).ok).toBe(true);
    expect(deck.calls).toEqual(['pause', 'stop']);
  });

  it('stops only what it started, so a track the artist loaded is left playing', async () => {
    const { executor, deck } = makePlayer();
    expect(executor.stopSound()).toBe(false);

    executor.execute(audioAction({ clip: 'music.mp3' }));
    await flush();
    expect(executor.stopSound('the set stopped')).toBe(true);
    expect(deck.calls).toContain('stop');
    // And not twice: the bed is no longer the performer's once it is stopped.
    expect(executor.stopSound()).toBe(false);
  });

  it('is off when the scenario says the sound is the musician\'s', () => {
    const { executor, deck } = makePlayer();
    executor.rules = normalizeRules({ allowAudio: false });

    expect(executor.execute(audioAction({ clip: 'music.mp3' })).reason).toMatch(/rules.allowAudio/);
    expect(deck.calls).toEqual([]);
  });

  it('says so when the live input it just took over was the artist\'s', async () => {
    const lines = [];
    const deck = fakeDeck({ play: async () => ({ ok: true, stoppedLive: 'mic' }) });
    const executor = makeExecutor({ audioDeck: deck, log: (level, message) => lines.push(`${level}: ${message}`) });
    executor.setSounds([sound('music.mp3')]);

    executor.execute(audioAction({ clip: 'music.mp3' }));
    await flush();

    expect(lines.join('\n')).toMatch(/warn: Live input stopped/);
  });

  it('has nowhere to play a bed in a build with no audio, and says that', () => {
    const executor = makeExecutor({});
    expect(executor.execute(audioAction({ clip: 'music.mp3' })).reason).toMatch(/no audio transport/);
  });
});

describe('the editor\'s timeline', () => {
  function fakeTimeline(start = {}) {
    const state = {
      enabled: false, duration: 10, currentTime: 0, loop: true,
      loopStart: 0, loopEnd: 10, playing: false, fps: 60, ...start,
    };
    return {
      state,
      isEnabled: () => state.enabled,
      enable: () => { state.enabled = true; },
      disable: () => { state.enabled = false; },
      isPlaying: () => state.playing,
      pause: () => { state.playing = false; },
      getFPS: () => state.fps,
      getDuration: () => state.duration,
      setDuration: (value) => { state.duration = value; },
      getLoop: () => state.loop,
      setLoop: (value) => { state.loop = value; },
      getLoopStart: () => state.loopStart,
      getLoopEnd: () => state.loopEnd,
      setLoopRegion: (a, b) => { state.loopStart = a; state.loopEnd = b; },
      getCurrentTime: () => state.currentTime,
      setCurrentTime: (value) => { state.currentTime = value; },
      storeOriginalValues: () => { state.stored = (state.stored || 0) + 1; },
    };
  }

  const withTimeline = (start) => {
    const timelineManager = fakeTimeline(start);
    const executor = makeExecutor({ editor: { graph: { nodes: [] }, timelineManager } });
    return { executor, timeline: timelineManager };
  };

  it('sets the section\'s length and enables it, which is what nothing did before', () => {
    const { executor, timeline } = withTimeline();
    expect(executor.armTimeline(48).ok).toBe(true);

    expect(timeline.state.duration).toBe(48);
    expect(timeline.state.loopStart).toBe(0);
    expect(timeline.state.loopEnd).toBe(48);
    expect(timeline.state.loop).toBe(true);
    expect(timeline.state.enabled).toBe(true);
    expect(timeline.state.currentTime).toBe(0);
  });

  it('leaves the duration alone for a section with no length of its own', () => {
    // It runs until a cue or a condition ends it. Whatever the scene brought
    // with it is a better answer than a number invented here.
    const { executor, timeline } = withTimeline({ duration: 30 });
    executor.armTimeline(0);
    expect(timeline.state.duration).toBe(30);
    expect(timeline.state.enabled).toBe(true);
  });

  it('takes the timeline\'s own transport out of the way rather than racing it', () => {
    const { executor, timeline } = withTimeline({ playing: true });
    executor.armTimeline(20);
    expect(timeline.state.playing).toBe(false);
  });

  it('puts the playhead where the section is', () => {
    const { executor, timeline } = withTimeline();
    executor.armTimeline(40);
    executor.syncTimeline(12.5);
    expect(timeline.state.currentTime).toBe(12.5);
  });

  it('wraps a section that outlasts its hold, the way the bed under it loops', () => {
    const { executor, timeline } = withTimeline();
    executor.armTimeline(40);
    executor.syncTimeline(95);
    expect(timeline.state.currentTime).toBe(15);
  });

  it('does not move a timeline it never armed', () => {
    const { executor, timeline } = withTimeline();
    expect(executor.syncTimeline(5)).toBe(false);
    expect(timeline.state.currentTime).toBe(0);
  });

  it('gives back the timeline the artist had, not the first section\'s', () => {
    const { executor, timeline } = withTimeline({ duration: 8, loopEnd: 8, currentTime: 3 });
    executor.armTimeline(48);
    executor.armTimeline(90);
    executor.syncTimeline(30);
    executor.releaseTimeline();

    expect(timeline.state.enabled).toBe(false);
    expect(timeline.state.duration).toBe(8);
    expect(timeline.state.loopEnd).toBe(8);
    expect(timeline.state.currentTime).toBe(3);
  });

  it('re-reads the parameters before disabling, so nothing stale is written back', () => {
    // disable() restores what it stored when the timeline was enabled, and by
    // then the graph is whatever scene the set finished on. Storing again
    // makes that restore a no-op against what is actually on the canvas.
    const { executor, timeline } = withTimeline();
    executor.armTimeline(48);
    executor.releaseTimeline();
    expect(timeline.state.stored).toBe(1);
  });

  it('leaves a timeline the artist had already enabled enabled', () => {
    const { executor, timeline } = withTimeline({ enabled: true });
    executor.armTimeline(48);
    executor.releaseTimeline();
    expect(timeline.state.enabled).toBe(true);
  });

  it('says there is no timeline rather than throwing in a build without one', () => {
    const executor = makeExecutor({ editor: { graph: { nodes: [] } } });
    expect(executor.armTimeline(10).ok).toBe(false);
    expect(executor.releaseTimeline()).toBe(false);
  });
});
