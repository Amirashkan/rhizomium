// The pipeline entered from the other end: a set that already exists, on a rig
// with none of its scenes on it.
//
// What is under test is mostly one question — is the patch that gets built
// SUITABLE for the section that is going to play it — and the answer is made
// of small things: it is installed under the name the set already uses, it is
// asked for the node names the section's own drives address, and building it
// does not rewrite the set around it.

import { describe, it, expect, vi } from 'vitest';
import { ShowBuilder, manifestFromScenario, unmetRequirements } from '../src/performer/ShowBuilder.js';
import { lookPrompt, MANIFEST_LIMITS } from '../src/performer/ShowManifest.js';

/** A set with three sections, none of whose scenes are on this rig. */
const SET = Object.freeze({
  name: 'Night set',
  notes: 'a dark support slot',
  bpm: 128,
  signals: [
    { name: 'bass', source: 'audio', channel: 'low' },
    { name: 'energy', source: 'osc', address: '/rhizo/perf/energy' },
  ],
  sections: [
    {
      id: 'opening', name: 'Opening', mood: 'patient, cold', look: { scene: 'Deep Fog' },
      hold: { bars: 32 }, next: 'build',
      drives: [{ signal: 'bass', node: 'Warp', param: 'amount' }],
      moves: [{ at: { bars: 8 }, do: [{ type: 'param', node: 'Warp', param: 'speed', to: 1.6 }] }],
    },
    { id: 'build', name: 'Build', look: { scene: 'Tightening' }, intensity: 0.6 },
    { id: 'drop', name: 'Drop', intensity: 1 },
  ],
  cues: [{ name: 'drop', do: [{ type: 'section', to: 'drop' }] }],
  rules: { minSectionBars: 8, allowGraphEdits: false },
});

const patch = (n = 2) => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: 'Noise', x: 0, y: 0, params: {} })),
  connections: [],
});

// The whole point of a look's `requires`: the set already drives "Warp.amount",
// so the patch built for it has to have that node and that parameter. Nothing
// used to check, and a look that came back without them was indistinguishable
// from one that worked — it installs, it plays, and every drive in the section
// writes into a node that is not there.
describe('unmetRequirements', () => {
  const needs = [{ node: 'Warp', param: 'amount' }];

  it('is satisfied by the node kind, the way the executor resolves one', () => {
    const built = { nodes: [{ id: 'n0', kind: 'Warp', params: { amount: 0.5 } }] };
    expect(unmetRequirements(built, needs)).toEqual([]);
  });

  it('is satisfied by the name the model gave the node', () => {
    const built = { nodes: [{ id: 'n0', kind: 'Blur', name: 'Warp', params: { amount: 0 } }] };
    expect(unmetRequirements(built, needs)).toEqual([]);
  });

  it('reports a node that is simply not there', () => {
    const built = { nodes: [{ id: 'n0', kind: 'Noise', params: {} }] };
    expect(unmetRequirements(built, needs)).toEqual(['Warp.amount']);
  });

  // A node that resolves and a parameter that does not is the same failure one
  // step in: the drive finds its node and writes nowhere.
  it('reports a node that arrived without the parameter', () => {
    const built = { nodes: [{ id: 'n0', kind: 'Warp', params: { speed: 1 } }] };
    expect(unmetRequirements(built, needs)).toEqual(['Warp.amount']);
  });

  it('asks nothing of a look the set does not reach into', () => {
    expect(unmetRequirements({ nodes: [] }, [])).toEqual([]);
  });
});

describe('manifestFromScenario', () => {
  it('asks for a look per section that has nothing to show', () => {
    const plan = manifestFromScenario(SET);

    expect(plan.missing.map((one) => one.sectionId)).toEqual(['opening', 'build', 'drop']);
    expect(plan.missing[0].why).toMatch(/not on the rig/);
    expect(plan.missing[2].why).toMatch(/no look at all/);
  });

  it('names each look after the scene the set already asks for', () => {
    const plan = manifestFromScenario(SET);

    // Installed under this name, the section that names it plays it without
    // one character of the scenario changing.
    expect(plan.missing.map((one) => one.name)).toEqual(['Deep Fog', 'Tightening', 'Drop']);
  });

  it('leaves a section whose scene is on the rig alone, and pays nothing for it', () => {
    const plan = manifestFromScenario(SET, { sceneNames: ['Deep Fog'] });

    expect(plan.missing.map((one) => one.name)).toEqual(['Tightening', 'Drop']);
    expect(plan.satisfied.map((one) => one.name)).toEqual(['Opening']);
    // Still in the manifest: every look call is told the whole set in order,
    // and a set with a hole in it is a different set.
    expect(plan.manifest.looks).toHaveLength(3);
    expect(plan.manifest.looks[0].scene).toBe('Deep Fog');
    expect(plan.manifest.looks[0].brief).toBe('');
  });

  it('carries the node and parameter names the section already drives', () => {
    const plan = manifestFromScenario(SET);
    const opening = plan.manifest.looks[0];

    expect(opening.requires).toEqual([
      { node: 'Warp', param: 'amount' },
      { node: 'Warp', param: 'speed' },
    ]);

    // And they reach the prompt as names, not as a hint.
    const prompt = lookPrompt(plan.manifest, opening);
    expect(prompt).toContain('a node named exactly "Warp", with a parameter named exactly "amount"');
    expect(prompt).toContain('named exactly "speed"');
  });

  it('says which audio a look has to answer, from the drives that are bound', () => {
    const plan = manifestFromScenario(SET);

    // "bass" is an audio signal on the low channel and the opening drives it.
    expect(plan.manifest.looks[0].reactsTo).toEqual(['low']);
    // Nothing is bound in the drop, so it is not told it answers everything.
    expect(plan.manifest.looks[2].reactsTo).toEqual([]);
  });

  it('writes a brief out of what the set already says about the section', () => {
    const plan = manifestFromScenario(SET);

    expect(plan.manifest.looks[0].brief).toContain('patient, cold');
    expect(plan.manifest.looks[0].brief).toContain('Deep Fog');
    // And is honest when the set says nothing at all.
    expect(plan.manifest.looks[2].brief).toMatch(/says nothing about it beyond its name/);
  });

  it('leaves a section that plays a preset or its own patch out of it', () => {
    const plan = manifestFromScenario({
      sections: [
        { id: 'one', name: 'One', look: { preset: 'soft-preset' } },
        { id: 'two', name: 'Two', look: { patch: { nodes: [{ id: 'a', kind: 'Noise' }] } } },
        { id: 'three', name: 'Three' },
      ],
    });

    expect(plan.missing.map((one) => one.sectionId)).toEqual(['three']);
    expect(plan.skipped.map((one) => one.why)).toEqual([
      'plays the preset "soft-preset"',
      'carries a patch of its own',
    ]);
  });

  it('builds one look for two sections that name the same absent scene', () => {
    const plan = manifestFromScenario({
      sections: [
        { id: 'one', name: 'One', look: { scene: 'Fog' } },
        { id: 'two', name: 'Two', look: { scene: 'Fog' } },
      ],
    });

    expect(plan.missing).toHaveLength(1);
    expect(plan.skipped[0].why).toMatch(/already being built/);
  });

  it('drops a look that costs nothing before one that costs a call', () => {
    // Four already on the rig, eleven that are not: three too many for one
    // manifest, and the three that go are the free ones.
    const sections = Array.from({ length: MANIFEST_LIMITS.looks + 3 }, (_, i) => ({
      id: `s${i}`, name: `S${i}`, look: { scene: i < 4 ? 'On The Rig' : `Missing ${i}` },
    }));
    const plan = manifestFromScenario({ sections }, { sceneNames: ['On The Rig'] });

    expect(plan.manifest.looks).toHaveLength(MANIFEST_LIMITS.looks);
    expect(plan.missing).toHaveLength(MANIFEST_LIMITS.looks - 1);
    expect(plan.satisfied).toHaveLength(1);
    expect(plan.deferred).toHaveLength(0);
  });

  it('leaves the looks past a build\'s reach for the next press rather than dropping them', () => {
    const sections = Array.from({ length: MANIFEST_LIMITS.looks + 2 }, (_, i) => ({
      id: `s${i}`, name: `S${i}`,
    }));
    const plan = manifestFromScenario({ sections });

    expect(plan.missing).toHaveLength(MANIFEST_LIMITS.looks);
    // Still missing when this build finishes, so pressing again picks them up.
    expect(plan.deferred.map((one) => one.name)).toEqual(['S12', 'S13']);
  });

  it('reads a set with no sections without inventing one', () => {
    const plan = manifestFromScenario({ name: 'Empty' });
    expect(plan.missing).toEqual([]);
    expect(plan.manifest.looks).toEqual([]);
  });

  it('calls a set counted only in seconds unmetered, and anything else metered', () => {
    const free = manifestFromScenario({ sections: [{ id: 'a', name: 'A', hold: { seconds: 90 } }] });
    const metered = manifestFromScenario({ sections: [{ id: 'a', name: 'A', hold: { bars: 32 } }] });
    const silent = manifestFromScenario({ sections: [{ id: 'a', name: 'A' }] });

    expect(free.manifest.pulse).toBe('free');
    expect(metered.manifest.pulse).toBe('metered');
    // Nothing said either way stays metered: being told there is no pulse when
    // there is one is the more expensive mistake.
    expect(silent.manifest.pulse).toBe('metered');
  });
});

describe('building into a set that already exists', () => {
  function builder(overrides = {}) {
    const installed = [];
    const deps = {
      generatePatch: vi.fn(async () => ({ patch: patch(), title: 'A patch', notes: '' })),
      installScene: vi.fn((name) => { installed.push(name); return { id: `scene_${name}`, name }; }),
      authorScenario: vi.fn(async () => ({ scenario: { name: 'Rewritten', sections: [] } })),
      ...overrides,
    };
    return { builder: new ShowBuilder(deps), deps, installed };
  }

  it('does not spend a call rewriting a set the artist already wrote', async () => {
    const { builder: show, deps } = builder();
    const plan = manifestFromScenario(SET);

    const report = await show.build(plan.manifest, { scenario: SET });

    expect(deps.generatePatch).toHaveBeenCalledTimes(3);
    expect(deps.authorScenario).not.toHaveBeenCalled();
    expect(report.wrote).toBe('given');
    expect(report.scenario.name).toBe('Night set');
  });

  it('keeps the drives, moves, cues and rules that are the reason it was written', async () => {
    const { builder: show } = builder();
    const plan = manifestFromScenario(SET);

    const { scenario } = await show.build(plan.manifest, { scenario: SET });
    const opening = scenario.sections[0];

    expect(opening.drives[0]).toMatchObject({ node: 'Warp', param: 'amount', signal: 'bass' });
    expect(opening.moves[0].do[0]).toMatchObject({ type: 'param', node: 'Warp' });
    expect(scenario.cues.map((cue) => cue.name)).toEqual(['drop']);
    expect(scenario.rules.minSectionBars).toBe(8);
    expect(scenario.sections).toHaveLength(3);
  });

  it('makes every section play the patch that was built for it', async () => {
    const { builder: show, installed } = builder();
    const plan = manifestFromScenario(SET);

    const { scenario } = await show.build(plan.manifest, { scenario: SET });

    expect(installed).toEqual(['Deep Fog', 'Tightening', 'Drop']);
    expect(scenario.sections.map((section) => section.look)).toEqual([
      { kind: 'scene', scene: 'Deep Fog' },
      { kind: 'scene', scene: 'Tightening' },
      { kind: 'scene', scene: 'Drop' },
    ]);
  });

  it('keeps the looks it built when one of them fails', async () => {
    let call = 0;
    const { builder: show } = builder({
      generatePatch: vi.fn(async () => {
        call += 1;
        if (call === 2) throw new Error('the model fell over');
        return { patch: patch(), title: '', notes: '' };
      }),
    });
    const plan = manifestFromScenario(SET);

    const report = await show.build(plan.manifest, { scenario: SET });

    expect(report.built.filter((entry) => entry.generated)).toHaveLength(2);
    // Among the problems rather than first among them: the looks that DID
    // build are also reported here, because this suite's stub patch is two
    // Noise nodes and the set drives "Warp".
    expect(report.problems.map((one) => one.message).join('\n')).toMatch(/fell over/);
    // The section whose look failed still names what it always named. It is
    // inert, exactly as inert as it was before the build, and one press away
    // from being built again — which is the point of not rewriting the set.
    expect(report.scenario.sections[1].look).toEqual({ kind: 'scene', scene: 'Tightening' });
  });

  it('says which looks came back without the nodes the set drives', async () => {
    const { builder: show } = builder();
    const plan = manifestFromScenario(SET);

    const report = await show.build(plan.manifest, { scenario: SET });

    // The stub patch is Noise nodes; the set drives "Warp". Every look is
    // still installed — a look with a hole in it beats no look at all — but
    // the hole is named here rather than found on stage.
    const said = report.problems.map((one) => one.message).join('\n');
    expect(said).toMatch(/came back without "Warp\.amount"/);
    expect(said).toMatch(/will do nothing/);
    expect(report.built.filter((entry) => entry.generated)).toHaveLength(3);
  });

  it('tells each look about the whole set, including the ones already on the rig', async () => {
    const { builder: show, deps } = builder();
    const plan = manifestFromScenario(SET, { sceneNames: ['Deep Fog'], brief: 'a dark support slot' });

    await show.build(plan.manifest, { scenario: SET });

    expect(deps.generatePatch).toHaveBeenCalledTimes(2);
    const [, context] = deps.generatePatch.mock.calls[0];
    expect(context.show).toContain('1. Opening');
    expect(context.show).toContain('a dark support slot');
  });
});
