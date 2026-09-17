// Building a show: patches, scenes, a set, and what happens when part of it
// fails halfway through.
//
// Both model calls and the scene installer are injected, so none of this
// touches the network, the editor or the GPU — which is the point of the
// pipeline being shaped the way it is. What is actually under test is the
// discipline around spending someone's allowance: nothing already paid for is
// thrown away, and a refusal from the gallery stops the build rather than
// being discovered once per remaining look.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ShowBuilder,
  bindLooks,
  scenarioFromManifest,
  isQuotaRefusal,
} from '../src/performer/ShowBuilder.js';
import { normalizeManifest } from '../src/performer/ShowManifest.js';
import { GrantError } from '../src/ai/entitlements.js';

/** A three-look show, small enough to read in a failure message. */
const MANIFEST = Object.freeze({
  show: 'Test set',
  brief: 'three looks',
  bpm: 128,
  looks: [
    { id: 'opening', name: 'Opening', brief: 'slow fog, near black', hold: { bars: 32 }, next: 'build' },
    { id: 'build', name: 'Build', brief: 'tightening structure', hold: { bars: 16 }, next: 'drop' },
    { id: 'drop', name: 'Drop', brief: 'hard and white', hold: { bars: 32 } },
  ],
  cues: ['drop'],
});

/** A patch shaped the way the backend hands one over. */
const patch = (n = 3) => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: 'Noise', x: i * 270, y: 0, params: {} })),
  connections: [],
});

/** A scenario shaped the way ai.performer_scenario answers. */
function modelScenario(ids = ['opening', 'build', 'drop']) {
  return {
    scenario: {
      name: 'Test set',
      sections: ids.map((id, index) => ({
        id,
        name: id[0].toUpperCase() + id.slice(1),
        enter: index === 0 ? 'manual' : { bars: 32 },
        look: { scene: 'something the model made up' },
      })),
    },
    note: 'watch the drop',
  };
}

describe('ShowBuilder', () => {
  let generatePatch;
  let installScene;
  let authorScenario;
  let installed;

  beforeEach(() => {
    installed = [];
    generatePatch = vi.fn(async () => ({ patch: patch(), title: 'A patch', notes: 'turn the speed' }));
    installScene = vi.fn((name) => {
      installed.push(name);
      return { id: `scene_${installed.length}`, name };
    });
    authorScenario = vi.fn(async () => modelScenario());
  });

  const builder = () => new ShowBuilder({ generatePatch, installScene, authorScenario });

  it('generates one patch per look and installs each under the look name', async () => {
    const report = await builder().build(MANIFEST);

    expect(generatePatch).toHaveBeenCalledTimes(3);
    expect(installed).toEqual(['Opening', 'Build', 'Drop']);
    expect(report.built.filter((entry) => entry.generated)).toHaveLength(3);
  });

  it('installs each look with the length the manifest gave it', async () => {
    await builder().build(MANIFEST);

    // 32 bars at 128 in 4/4 is 60s. It becomes the scene's own duration and
    // the timeline the scene carries, so cutting to it sets the transport to
    // the length the set was written to.
    expect(installScene.mock.calls[0][2].holdSeconds).toBe(60);
    expect(installScene.mock.calls[1][2].holdSeconds).toBe(30);
  });

  it('tells each patch call about the show as well as the look', async () => {
    await builder().build(MANIFEST);

    const [prompt, context] = generatePatch.mock.calls[1];
    expect(prompt).toContain('tightening structure');
    expect(context.show).toContain('Test set');
    expect(context.look.id).toBe('build');
  });

  it('writes the set only after the looks exist, and tells the model about them', async () => {
    await builder().build(MANIFEST);

    // The ordering is the whole design: a scenario call made first would be
    // told no scenes are loaded, and is told outright not to invent any.
    expect(authorScenario).toHaveBeenCalledOnce();
    const [brief, context] = authorScenario.mock.calls[0];
    expect(brief).toContain('the scene "Opening"');
    expect(context.scenes.map((scene) => scene.name)).toEqual(['Opening', 'Build', 'Drop']);
  });

  it('tells the model what each built scene can be driven on', async () => {
    generatePatch = vi.fn(async () => ({
      patch: {
        nodes: [
          { id: 'n0', kind: 'ComputeNoise', name: 'ComputeNoise', params: { scale: 8, mode: 'fbm' } },
          { id: 'n1', kind: 'Blur', name: 'Blur', params: { radius: 4, tint: '#fff' } },
        ],
        connections: [],
      },
    }));

    await builder().build(MANIFEST);

    // Without this the only parameters the scenario call has ever been given
    // are the ones in whatever patch is open in the editor — which during a
    // build is not the graph any of these sections will load. The model does
    // as it is told, names those, and every drive in the set addresses a node
    // that is not there.
    const [, context] = authorScenario.mock.calls[0];
    expect(context.scenes[0].parameters).toEqual(['ComputeNoise.scale', 'Blur.radius']);
  });

  it('binds every section to the scene that was actually built for it', async () => {
    const report = await builder().build(MANIFEST);

    // The model's own scene names are overwritten. A near-miss name is an
    // inert section, and it would be inert at showtime rather than here.
    expect(report.scenario.sections.map((section) => section.look.scene))
      .toEqual(['Opening', 'Build', 'Drop']);
    expect(report.bound).toHaveLength(3);
  });

  it('does not pay to generate a look that names a scene the artist already has', async () => {
    const report = await builder().build({
      ...MANIFEST,
      looks: [{ id: 'opening', name: 'Opening', scene: 'my-own-scene' }, MANIFEST.looks[1]],
    });

    expect(generatePatch).toHaveBeenCalledTimes(1);
    expect(report.scenario.sections[0].look.scene).toBe('my-own-scene');
  });

  it('reports progress per look, so a four-minute build is not a spinner', async () => {
    const events = [];
    await builder().build(MANIFEST, { onProgress: (event) => events.push(event) });

    expect(events.filter((e) => e.phase === 'look' && e.status === 'start')).toHaveLength(3);
    expect(events.filter((e) => e.phase === 'look' && e.status === 'ok')).toHaveLength(3);
    expect(events.at(-1).phase).toBe('done');
  });

  it('keeps the looks it already built when one fails, and says which', async () => {
    generatePatch.mockImplementationOnce(async () => ({ patch: patch() }))
      .mockImplementationOnce(async () => { throw new Error('the model fell over'); })
      .mockImplementationOnce(async () => ({ patch: patch() }));

    const report = await builder().build(MANIFEST);

    expect(installed).toEqual(['Opening', 'Drop']);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].where).toContain('Build');
    expect(report.stopped).toBe('');
  });

  it('stops the moment the gallery refuses, rather than finding out once per look', async () => {
    generatePatch.mockImplementationOnce(async () => ({ patch: patch() }))
      .mockImplementationOnce(async () => { throw new GrantError('Out of patch generations today.'); });

    const report = await builder().build(MANIFEST);

    expect(generatePatch).toHaveBeenCalledTimes(2);
    expect(report.stopped).toMatch(/Out of patch generations/);
    // And what was already paid for is still there.
    expect(installed).toEqual(['Opening']);
    expect(report.scenario.sections[0].look.scene).toBe('Opening');
  });

  it('does not spend a scenario call on a build that stopped', async () => {
    generatePatch.mockImplementationOnce(async () => { throw new GrantError('no quota'); });

    await builder().build(MANIFEST);
    expect(authorScenario).not.toHaveBeenCalled();
  });

  it('still hands back a playable set when the scenario call fails', async () => {
    authorScenario.mockRejectedValue(new Error('the set call timed out'));

    const report = await builder().build(MANIFEST);

    // The patches are built and paid for. An artist who has them gets a set
    // that plays them, written from the manifest rather than by a model.
    expect(report.wrote).toBe('manifest');
    expect(report.scenario.sections).toHaveLength(3);
    expect(report.scenario.sections.map((section) => section.look.scene))
      .toEqual(['Opening', 'Build', 'Drop']);
    expect(report.problems[0].where).toBe('the set');
  });

  it('can build the looks and write the set itself, without the second call', async () => {
    const report = await builder().build(MANIFEST, { writeScenario: false });

    expect(authorScenario).not.toHaveBeenCalled();
    expect(report.wrote).toBe('manifest');
    expect(report.scenario.sections).toHaveLength(3);
  });

  it('stops between looks when asked to', async () => {
    // Between calls is the only cancellation worth having: a call already in
    // flight has already been paid for.
    const report = await builder().build(MANIFEST, {
      shouldStop: () => generatePatch.mock.calls.length >= 2,
    });

    expect(report.stopped).toBe('cancelled');
    expect(generatePatch).toHaveBeenCalledTimes(2);
    expect(installed).toEqual(['Opening', 'Build']);
    // And what was built is still bound into the set it hands back.
    expect(report.scenario.sections.slice(0, 2).map((s) => s.look.scene))
      .toEqual(['Opening', 'Build']);
  });

  it('refuses a manifest that cannot be built, before spending anything', async () => {
    await expect(builder().build({ show: 'empty' })).rejects.toThrow(/at least one look/);
    expect(generatePatch).not.toHaveBeenCalled();
  });

  it('treats an empty answer as a failed look rather than installing nothing', async () => {
    generatePatch.mockImplementation(async () => ({ patch: { nodes: [], connections: [] } }));

    const report = await builder().build(MANIFEST);
    expect(installScene).not.toHaveBeenCalled();
    expect(report.problems).toHaveLength(3);
  });

  it('will not run two builds over each other', async () => {
    const one = builder();
    const first = one.build(MANIFEST);
    await expect(one.build(MANIFEST)).rejects.toThrow(/already being built/);
    await first;
  });
});

describe('bindLooks', () => {
  const show = normalizeManifest(MANIFEST);
  const built = [
    { lookId: 'opening', sceneName: 'Opening', generated: true },
    { lookId: 'build', sceneName: 'Build', generated: true },
    { lookId: 'drop', sceneName: 'Drop', generated: true },
  ];

  it('matches on id first', () => {
    const { scenario } = bindLooks(modelScenario().scenario, show, built);
    expect(scenario.sections.map((s) => s.look.scene)).toEqual(['Opening', 'Build', 'Drop']);
  });

  it('falls back to the section name when the model renamed the ids', () => {
    const scenario = {
      sections: [
        { id: 's1', name: 'Opening', enter: 'manual' },
        { id: 's2', name: 'Build', enter: { bars: 32 } },
        { id: 's3', name: 'Drop', enter: { bars: 16 } },
      ],
    };
    const result = bindLooks(scenario, show, built);
    expect(result.scenario.sections.map((s) => s.look.scene)).toEqual(['Opening', 'Build', 'Drop']);
    expect(result.unbound).toEqual([]);
  });

  it('falls back to position when the counts line up and nothing else matches', () => {
    const scenario = {
      sections: [
        { id: 'a', name: 'First', enter: 'manual' },
        { id: 'b', name: 'Second', enter: { bars: 32 } },
        { id: 'c', name: 'Third', enter: { bars: 16 } },
      ],
    };
    const result = bindLooks(scenario, show, built);
    expect(result.scenario.sections.map((s) => s.look.scene)).toEqual(['Opening', 'Build', 'Drop']);
  });

  it('adds a section for a look nothing in the set plays', () => {
    // The patch exists and has been paid for. A set that does not play it is
    // the one outcome this whole pipeline is for avoiding.
    const scenario = { sections: [{ id: 'opening', name: 'Opening', enter: 'manual' }] };
    const result = bindLooks(scenario, show, built);

    expect(result.scenario.sections).toHaveLength(3);
    expect(result.scenario.sections.map((s) => s.look.scene)).toEqual(['Opening', 'Build', 'Drop']);
    expect(result.unbound).toEqual(['build', 'drop']);
  });

  it('never binds two looks to the same section', () => {
    const scenario = { sections: [{ id: 'opening', name: 'Opening', enter: 'manual' }] };
    const { scenario: bound } = bindLooks(scenario, show, built);
    const scenes = bound.sections.map((s) => s.look.scene);
    expect(new Set(scenes).size).toBe(scenes.length);
  });

  it('attaches the bed the manifest named, whoever wrote the set', () => {
    // The file is a fact about the folder, not a decision for the model: the
    // hold was measured from it, and a set that describes a bed it never plays
    // is the mismatch this path exists to close.
    const withSound = normalizeManifest({
      ...MANIFEST,
      looks: MANIFEST.looks.map((look, index) => (index === 0 ? { ...look, sound: 'media/music.mp3' } : look)),
    });
    const { scenario } = bindLooks(modelScenario().scenario, withSound, built);

    expect(scenario.sections[0].onEnter[0]).toMatchObject({
      type: 'audio', clip: 'media/music.mp3', transport: 'play', quantize: 'off',
    });
    // Only that section: nothing is put under a look that named no sound.
    expect(scenario.sections[1].onEnter.some((action) => action.type === 'audio')).toBe(false);
  });

  it('never leaves two beds on one entry', () => {
    const withSound = normalizeManifest({
      ...MANIFEST,
      looks: MANIFEST.looks.map((look, index) => (index === 0 ? { ...look, sound: 'media/music.mp3' } : look)),
    });
    const scenario = {
      sections: [{
        id: 'opening',
        name: 'Opening',
        enter: 'manual',
        onEnter: [{ type: 'audio', clip: 'something-else.mp3' }, { type: 'master', to: 0.8 }],
      }],
    };
    const { scenario: bound } = bindLooks(scenario, withSound, [built[0]]);

    const audio = bound.sections[0].onEnter.filter((action) => action.type === 'audio');
    expect(audio).toHaveLength(1);
    expect(audio[0].clip).toBe('media/music.mp3');
    // Everything else the section did on entry is still there.
    expect(bound.sections[0].onEnter.some((action) => action.type === 'master')).toBe(true);
  });

  it('leaves a section the show says nothing about alone', () => {
    const scenario = {
      sections: [
        { id: 'opening', name: 'Opening', enter: 'manual' },
        { id: 'interlude', name: 'Interlude', enter: { bars: 8 }, look: { preset: 'soft' } },
      ],
    };
    const { scenario: bound } = bindLooks(scenario, show, [built[0]]);
    expect(bound.sections[1].look).toEqual({ kind: 'preset', preset: 'soft' });
  });
});

describe('scenarioFromManifest', () => {
  it('writes a set that advances on the lengths the manifest gave', () => {
    const scenario = scenarioFromManifest(MANIFEST, [
      { lookId: 'opening', sceneName: 'Opening' },
      { lookId: 'build', sceneName: 'Build' },
      { lookId: 'drop', sceneName: 'Drop' },
    ]);

    // enter is what ends the section BEFORE it, so each one is the previous
    // look's hold.
    expect(scenario.sections[0].enter.kind).toBe('manual');
    expect(scenario.sections[1].enter).toMatchObject({ kind: 'bars', bars: 32 });
    expect(scenario.sections[2].enter).toMatchObject({ kind: 'bars', bars: 16 });
  });

  it('binds a cue named after a look to that look', () => {
    const scenario = scenarioFromManifest(MANIFEST, []);
    const drop = scenario.cues.find((cue) => cue.name === 'drop');
    expect(drop.do[0]).toMatchObject({ type: 'section', to: 'drop' });
  });

  it('writes an unmetered show in seconds, landing on what the musician plays', () => {
    const scenario = scenarioFromManifest({ ...MANIFEST, pulse: 'free' }, []);

    for (const section of scenario.sections) {
      expect(section.hold.bars).toBeFalsy();
      expect(section.hold.seconds).toBeGreaterThan(0);
      expect(section.transition.quantize).toBe('onset');
    }
    // 32 bars of 4 at 128 BPM is 60 seconds — the shape the artist wrote,
    // in the unit this show can be played in.
    expect(scenario.sections[0].hold.seconds).toBe(60);
    expect(scenario.rules.minSectionBars).toBe(0);
  });

  it('leaves the director off: a set nobody has read does not get a model in it', () => {
    expect(scenarioFromManifest(MANIFEST, []).rules.director.enabled).toBe(false);
  });
});

describe('a look with its own sound, written straight from the manifest', () => {
  it('plays it on the way into the section', () => {
    const scenario = scenarioFromManifest({
      ...MANIFEST,
      looks: [{ ...MANIFEST.looks[0], sound: 'media/music.mp3' }],
    }, [{ lookId: 'opening', sceneName: 'Opening' }]);

    expect(scenario.sections[0].onEnter[0]).toMatchObject({
      type: 'audio', clip: 'media/music.mp3', transport: 'play',
    });
  });
});

describe('isQuotaRefusal', () => {
  it('knows a grant refusal from anything else', () => {
    expect(isQuotaRefusal(new GrantError('no'))).toBe(true);
    expect(isQuotaRefusal({ name: 'GrantError' })).toBe(true);
    expect(isQuotaRefusal(new Error('the model fell over'))).toBe(false);
    expect(isQuotaRefusal(null)).toBe(false);
  });
});
