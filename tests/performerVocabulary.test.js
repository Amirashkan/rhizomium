// What the performer knows it can reach for, end to end.
//
// A set that plays a scene it cannot address is the failure this covers, and
// it is the one that does not look like a failure: the scenes load, the
// sections advance, the log fills with successes, and the audience watches one
// dark frame for the length of the show. These tests follow the node names
// along the two paths that were dropping them — the build, and the live
// director — and check that an action which names nothing never reaches the
// stage.

import { describe, it, expect, vi } from 'vitest';
import { PerformerEngine } from '../src/performer/PerformerEngine.js';
import { PerformerClock } from '../src/performer/PerformerClock.js';
import { PerformerDirector } from '../src/performer/PerformerDirector.js';
import { ActionExecutor } from '../src/performer/ActionExecutor.js';
import { normalizeAction } from '../src/performer/actions.js';
import { scenarioBrief } from '../src/performer/ShowManifest.js';

const node = (id, kind, extra = {}) => ({ id, kind, params: {}, ...extra });

/** An executor over a real graph, with the write side stubbed out. */
function executorOver(nodes) {
  const executor = new ActionExecutor({ editor: { graph: { nodes } } });
  executor.writeParam = vi.fn(() => true);
  return executor;
}

function engineOver(nodes, scenario, options = {}) {
  const state = { now: 0 };
  const clock = new PerformerClock({ now: () => state.now, bpm: 120, beatsPerBar: 4 });
  const engine = new PerformerEngine({ clock, executor: executorOver(nodes), ...options });
  engine.loadScenario(scenario);

  const play = (seconds) => {
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < frames; i++) {
      state.now += (seconds * 1000) / frames;
      engine.tick();
    }
  };

  return { engine, state, play };
}

const oneSection = (drives) => ({
  name: 'set',
  sections: [{ id: 'a', name: 'A', drives }],
  rules: { director: { enabled: false } },
});

describe('what the director is shown', () => {
  it('carries the patch it can address', () => {
    const { engine } = engineOver(
      [node('1', 'ComputeNoise', { name: 'membrane' })],
      oneSection([])
    );
    const names = engine.describeState().patch.nodes.map((one) => one.name);
    expect(names).toEqual(['membrane']);
  });

  it('carries the drives that are bound to nothing', () => {
    const { engine, play } = engineOver(
      [node('1', 'ComputeNoise', { name: 'membrane' })],
      oneSection([
        { signal: 'level', node: 'ComputeGradient', param: 'brightness' },
        { signal: 'low', node: 'membrane', param: 'scale' },
      ])
    );
    engine.start();
    play(1);

    const dead = engine.describeState().dead;
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ node: 'ComputeGradient', param: 'brightness' });
  });

  // The number that tells a held texture from a frozen one.
  it('counts the picture as moving while a drive really resolves', () => {
    const { engine, play } = engineOver(
      [node('1', 'ComputeNoise', { name: 'membrane' })],
      oneSection([{ signal: 'low', node: 'membrane', param: 'scale' }])
    );
    engine.start();
    play(30);
    expect(engine.stillSeconds()).toBe(0);
  });

  it('counts the picture as frozen when every drive is bound to nothing', () => {
    const { engine, play } = engineOver(
      [node('1', 'ComputeNoise', { name: 'membrane' })],
      oneSection([{ signal: 'level', node: 'ComputeGradient', param: 'brightness' }])
    );
    engine.start();
    play(30);
    expect(engine.stillSeconds()).toBeGreaterThan(25);
  });

  it('reads zero before anything has been started', () => {
    const { engine } = engineOver([node('1', 'ComputeNoise')], oneSection([]));
    expect(engine.stillSeconds()).toBe(0);
  });

  // The case that reads as a working set from every other angle: the node is
  // there, the parameter is there, the drive writes every frame. What it
  // writes is the bottom of its range, because nothing has ever come down that
  // signal — so the picture has not moved since the first frame and the old
  // reading of "a drive resolves, therefore the picture is alive" said it had.
  it('counts the picture as frozen when a resolving drive is fed by a signal that never arrived', () => {
    const { engine, play } = engineOver(
      [node('1', 'ComputeNoise', { name: 'membrane' })],
      {
        name: 'set',
        signals: [{ name: 'level', source: 'osc', address: '/never' }],
        sections: [{ id: 'a', name: 'A', drives: [{ signal: 'level', node: 'membrane', param: 'scale' }] }],
        rules: { director: { enabled: false } },
      }
    );
    engine.start();
    play(30);
    expect(engine.stillSeconds()).toBeGreaterThan(25);
  });
});

describe('the three things that black a canvas', () => {
  const withSignal = (drives) => ({
    name: 'set',
    signals: [{ name: 'level', source: 'osc', address: '/never' }],
    sections: [{ id: 'a', name: 'A', drives }],
    rules: { director: { enabled: false } },
  });

  it('names a drive whose signal never arrived, and what it is pinning', () => {
    const { engine, play } = engineOver(
      [node('1', 'ComputeNoise', { name: 'membrane' })],
      withSignal([{ signal: 'level', node: 'membrane', param: 'scale', min: 0, max: 2 }])
    );
    engine.start();
    play(1);

    const dead = engine.describeState().dead;
    expect(dead).toHaveLength(1);
    expect(dead[0].why).toContain('has never arrived');
    // The number the artist can actually see on the screen.
    expect(dead[0].pinnedAt).toBe(0);
  });

  it('carries the master fader, which blacks the output on its own', () => {
    const { engine } = engineOver([node('1', 'ComputeNoise')], oneSection([]));
    expect(engine.describeState().picture.master).toBe(1);

    engine.executor.setMaster(0);
    expect(engine.describeState().picture.master).toBe(0);

    // MasterOutput holds this for the whole module, so a test that pulls the
    // fader down and walks away pulls it down for everything after it.
    engine.executor.setMaster(1);
  });

  it('carries the blackout, which does too', () => {
    const { engine } = engineOver([node('1', 'ComputeNoise')], oneSection([]));
    expect(engine.describeState().picture.blackedOut).toBe(false);

    engine.executor.execute(normalizeAction({ type: 'blackout', on: true }), { now: 0 });
    expect(engine.describeState().picture.blackedOut).toBe(true);
  });
});

describe('a drive bound to nothing', () => {
  it('says so once, and not on the frame it was registered', () => {
    const lines = [];
    const executor = executorOver([node('1', 'ComputeNoise', { name: 'membrane' })]);
    executor.log = (level, message) => lines.push(`${level}: ${message}`);

    executor.execute(
      normalizeAction({ type: 'drive', signal: 'level', node: 'ComputeGradient', param: 'brightness' }),
      { now: 0 }
    );

    // A section registers its drives while its scene is still loading, so the
    // first moment must stay quiet or every section entry warns.
    executor.tick(0.5, null);
    expect(lines).toEqual([]);

    executor.tick(2, null);
    executor.tick(2, null);
    executor.tick(2, null);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('no node "ComputeGradient"');
    expect(lines[0]).toContain('doing nothing');
  });

  it('stays quiet for a drive whose node arrives late', () => {
    const lines = [];
    const nodes = [];
    const executor = new ActionExecutor({ editor: { graph: { nodes } } });
    executor.writeParam = vi.fn(() => true);
    executor.log = (level, message) => lines.push(message);

    executor.execute(
      normalizeAction({ type: 'drive', signal: 'low', node: 'membrane', param: 'scale' }),
      { now: 0 }
    );
    executor.tick(1, null);

    nodes.push(node('1', 'ComputeNoise', { name: 'membrane' }));
    executor.invalidateNodes();
    executor.tick(1, null);
    executor.tick(5, null);

    expect(lines).toEqual([]);
  });
});

describe('a plan that names nothing', () => {
  const answer = (actions) => Promise.resolve({ result: { actions, note: '' } });

  it('drops a drive with no node on it rather than spending a slot on it', async () => {
    const run = vi.fn(() => answer([
      { type: 'drive', signal: 'low', why: 'bind low to the tissue displacement strength' },
      { type: 'drive', signal: 'low', node: 'membrane', param: 'scale' },
    ]));
    const director = new PerformerDirector({ run, now: () => 0 });
    director.setEnabled(true);
    director.offer({
      scenario: { name: 's', notes: '', sections: [], cues: [], rules: { allowSceneChanges: true, allowPresets: true, allowParameterMoves: true, allowGraphEdits: false, director: { enabled: true, freedom: 0.4 } } },
      now: { bar: 0, bpm: 120 }, signals: {}, driving: [], recent: [], askedAtBeats: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const plan = director.take();
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].node).toBe('membrane');
  });

  it('sends the patch and the dead drives in the prompt', async () => {
    const run = vi.fn(() => answer([]));
    const director = new PerformerDirector({ run, now: () => 0 });
    director.setEnabled(true);
    director.offer({
      scenario: { name: 's', notes: '', sections: [], cues: [], rules: { allowSceneChanges: true, allowPresets: true, allowParameterMoves: true, allowGraphEdits: false, director: { enabled: true, freedom: 0.4 } } },
      now: { bar: 0, bpm: 120 },
      signals: {},
      driving: [],
      recent: [],
      patch: { nodes: [{ name: 'membrane', kind: 'ComputeNoise', params: [{ name: 'scale' }] }], total: 1, ambiguous: [] },
      dead: [{ signal: 'level', node: 'ComputeGradient', param: 'brightness', why: 'no node by that name' }],
      picture: { stillSeconds: 62 },
      askedAtBeats: 0,
    });

    const sent = run.mock.calls[0][1].state;
    expect(sent.patch.nodes[0].name).toBe('membrane');
    expect(sent.dead[0].node).toBe('ComputeGradient');
    expect(sent.picture.stillSeconds).toBe(62);
  });
});

describe('the brief the set is written from', () => {
  const manifest = {
    show: 'Cortex',
    bpm: 120,
    looks: [{ id: 'one', name: 'The Cortex Vacancy', brief: 'a dark violet ground' }],
  };

  it('lists what the look that was built actually calls its nodes', () => {
    const brief = scenarioBrief(manifest, [{
      lookId: 'one',
      sceneName: 'The Cortex Vacancy',
      handles: {
        nodes: [{
          name: 'membrane',
          kind: 'ComputeNoise',
          params: [{ name: 'scale', min: 0.1, max: 20, at: 4 }],
        }],
        total: 1,
        ambiguous: [],
      },
    }]);

    expect(brief).toContain('"membrane" (ComputeNoise)');
    expect(brief).toContain('scale 0.1..20, now 4');
    expect(brief).toContain('spelled exactly as they are listed');
  });

  it('says nothing about handles when nothing was built', () => {
    const brief = scenarioBrief(manifest, []);
    expect(brief).not.toContain('spelled exactly as they are listed');
  });
});
