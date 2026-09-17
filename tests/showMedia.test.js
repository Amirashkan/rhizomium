// Building a show on the artist's own footage.
//
// The rule that matters here is the one the whole feature exists to keep: a
// clip the artist put in the folder and named in the manifest ends up ON a node
// in the look that was generated for it. Everything else — which node, in what
// order, what happens when the model returns one texture node too few — is the
// machinery for keeping it when the model does not cooperate exactly.

import { describe, it, expect, vi } from 'vitest';
import { ShowBuilder, attachMedia } from '../src/performer/ShowBuilder.js';
import { indexShowFolder, mediaSlotName } from '../src/performer/ShowFolder.js';
import { lookPrompt, validateManifest } from '../src/performer/ShowManifest.js';
import { validateGeneratedPatch } from '../api/_lib/nodeCatalog.js';
import { buildUserMessage } from '../api/_lib/features.js';

/** A file the hand-rolled encoder can read with no Blob in sight. */
const clipFile = (name, type, byte = 1) => ({
  name,
  type,
  size: 2048,
  arrayBuffer: async () => new Uint8Array([byte]).buffer,
});

const FOLDER = indexShowFolder([
  { path: 'night.rzshow.json', file: { name: 'night.rzshow.json', size: 10, type: 'application/json' } },
  { path: 'media/fog-loop.mp4', file: clipFile('fog-loop.mp4', 'video/mp4', 1) },
  { path: 'media/grain.png', file: clipFile('grain.png', 'image/png', 2) },
]);

const clips = (...labels) =>
  labels.map((label) => FOLDER.media.find((item) => item.label === label));

/** A patch shaped the way the backend hands one over. */
const patch = (...nodes) => ({ nodes, connections: [] });

const texture = (id, name, kind = 'Texture2D') => ({ id, kind, name, x: 0, y: 0, params: {} });

describe('attachMedia', () => {
  it('puts a clip on the node the prompt asked for, by name', async () => {
    const [fog] = clips('fog-loop');
    const result = await attachMedia(
      patch({ id: 'n1', kind: 'Noise', params: {} }, texture('t1', mediaSlotName(fog))),
      [fog]
    );

    // Keyed by node id, in the shape a saved project's textures are — which is
    // what makes the scene restore down the ordinary loader's path.
    expect(result.textures.t1).toMatchObject({ filename: 'fog-loop.mp4', isVideo: true });
    expect(result.textures.t1.dataUrl).toMatch(/^data:video\/mp4;base64,/);
    expect(result.bound).toEqual([{ nodeId: 't1', path: 'media/fog-loop.mp4', kind: 'video' }]);
    expect(result.problems).toEqual([]);
  });

  it('finds the node even when the model wrote the name its own way', async () => {
    const [fog] = clips('fog-loop');
    const result = await attachMedia(patch(texture('t1', 'Media - Fog Loop')), [fog]);
    expect(result.bound[0].nodeId).toBe('t1');
  });

  it('records which of the two kinds of file the node is holding', async () => {
    const [fog, grain] = clips('fog-loop', 'grain');
    const result = await attachMedia(
      patch(texture('t1', mediaSlotName(fog)), texture('t2', mediaSlotName(grain))),
      [fog, grain]
    );

    // Without it the clip plays while the panel offers the controls for a still.
    expect(result.patch.nodes[0].params.sourceType).toBe('video');
    expect(result.patch.nodes[1].params.sourceType).toBe('image');
  });

  it('falls back to order when the model named nothing at all', async () => {
    const [fog, grain] = clips('fog-loop', 'grain');
    const result = await attachMedia(patch(texture('t1', ''), texture('t2', '')), [fog, grain]);

    expect(result.bound.map((one) => one.path)).toEqual(['media/fog-loop.mp4', 'media/grain.png']);
    // A node that arrived unnamed is named after what landed on it, so the
    // scenario has a handle to reach it by.
    expect(result.patch.nodes[0].name).toBe(mediaSlotName(fog));
  });

  it('uses a clip twice rather than leaving a node showing nothing', async () => {
    const [fog] = clips('fog-loop');
    const result = await attachMedia(patch(texture('t1', ''), texture('t2', '')), [fog]);

    // A node showing the first clip twice is a composition. A node showing
    // nothing is a black rectangle in a look that has already been paid for.
    expect(Object.keys(result.textures)).toEqual(['t1', 't2']);
    expect(result.textures.t1.dataUrl).toBe(result.textures.t2.dataUrl);
  });

  it('never puts a video on a cube map', async () => {
    const [fog, grain] = clips('fog-loop', 'grain');
    const result = await attachMedia(patch(texture('c1', '', 'TextureCube')), [fog, grain]);
    expect(result.bound).toEqual([{ nodeId: 'c1', path: 'media/grain.png', kind: 'image' }]);
  });

  it('says so, and keeps the look, when the model built it without a texture node', async () => {
    const result = await attachMedia(patch({ id: 'n1', kind: 'Noise', params: {} }), clips('fog-loop'));

    expect(result.textures).toEqual({});
    expect(result.problems[0]).toMatch(/without a texture node/);
    // The look is still installed. It cost a call either way.
    expect(result.patch.nodes).toHaveLength(1);
  });

  it('costs one clip, not the look, when a file cannot be read', async () => {
    const [fog, grain] = clips('fog-loop', 'grain');
    const broken = { ...fog, dataUrl: null, file: { name: 'x', type: 'video/mp4', arrayBuffer: async () => { throw new Error('gone'); } } };

    const result = await attachMedia(patch(texture('t1', ''), texture('t2', '')), [broken, grain]);

    expect(result.problems.some((p) => /could not read/.test(p))).toBe(true);
    expect(result.bound.map((one) => one.path)).toEqual(['media/grain.png']);
  });

  it('is a no-op with no clips, so every build that has none is untouched', async () => {
    const original = patch({ id: 'n1', kind: 'Noise', params: {} });
    const result = await attachMedia(original, []);
    expect(result.patch).toBe(original);
    expect(result.textures).toEqual({});
  });
});

describe('the look prompt, with media', () => {
  const manifest = {
    show: 'Night set',
    looks: [{ id: 'opening', name: 'Opening', brief: 'fog over the room', media: ['fog-loop'] }],
  };

  it('is unchanged when the look has no clips', () => {
    const plain = lookPrompt(manifest, manifest.looks[0], []);
    expect(plain).not.toMatch(/Texture2D/);
  });

  it('names the node each clip is about to arrive on', () => {
    const prompt = lookPrompt(manifest, manifest.looks[0], clips('fog-loop'));

    expect(prompt).toContain('"Media: fog-loop"');
    expect(prompt).toContain('moving footage');
    // The ban still stands for every node the artist did not supply a file for.
    expect(prompt).toMatch(/Do not add any other Texture2D/);
  });
});

describe('checking a manifest against the folder', () => {
  const withMedia = (media) => ({
    show: 'Night set',
    brief: 'one look',
    cues: ['drop'],
    signals: [{ name: 'energy', source: 'osc', address: '/x' }],
    looks: [{ id: 'opening', name: 'Opening', brief: 'fog over the room', media }],
  });

  it('warns at the desk about a clip that is not in the folder', () => {
    const { warnings } = validateManifest(withMedia(['smoke.mp4']), FOLDER);
    // Six patch calls later is too late to find this out.
    expect(warnings.some((w) => /Nothing in the folder is called "smoke.mp4"/.test(w.message))).toBe(true);
  });

  it('warns that a look naming clips has no folder open to find them in', () => {
    const { warnings } = validateManifest(withMedia(['fog-loop']), null);
    expect(warnings.some((w) => /no show folder is open/.test(w.message))).toBe(true);
  });

  it('says nothing about media a look asked for and the folder has', () => {
    const { warnings, errors } = validateManifest(withMedia(['fog-loop']), FOLDER);
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => /folder|clip/i.test(w.message))).toEqual([]);
  });

  it('points out footage nobody is using, with the line to paste', () => {
    const { warnings } = validateManifest(withMedia([]), FOLDER);
    const note = warnings.find((w) => w.where === 'media');
    expect(note.message).toContain('"media": ["fog-loop.mp4"]');
  });
});

describe('ShowBuilder, given a folder', () => {
  const manifest = {
    show: 'Night set',
    looks: [{ id: 'opening', name: 'Opening', brief: 'fog over the room', media: ['fog-loop'] }],
  };

  /** A builder whose model answers with whatever patch it is handed. */
  function builderFor(answer) {
    const generatePatch = vi.fn(async () => ({ patch: answer, title: 'Opening', notes: '' }));
    const installScene = vi.fn((name) => ({ id: 'scene_1', name }));
    return {
      generatePatch,
      installScene,
      builder: new ShowBuilder({ generatePatch, installScene }),
    };
  }

  it('tells the model which nodes the clips are arriving on', async () => {
    const [fog] = clips('fog-loop');
    const { builder, generatePatch } = builderFor(patch(texture('t1', mediaSlotName(fog))));

    await builder.build(manifest, { folder: FOLDER });

    const [prompt, context] = generatePatch.mock.calls[0];
    expect(prompt).toContain('"Media: fog-loop"');
    // Only the names travel. The bytes stay on the artist's machine and go on
    // the node here — the backend is told a texture node is legal, not shown
    // 4 MB of video.
    expect(context.media).toEqual([{ node: 'Media: fog-loop', kind: 'video', file: 'fog-loop.mp4' }]);
  });

  it('hands the scene its media, so the scene carries it like a saved project', async () => {
    const [fog] = clips('fog-loop');
    const { builder, installScene } = builderFor(patch(texture('t1', mediaSlotName(fog))));

    const report = await builder.build(manifest, { folder: FOLDER });

    const [, , meta] = installScene.mock.calls[0];
    expect(meta.textures.t1.filename).toBe('fog-loop.mp4');
    expect(report.built[0].media).toEqual(['media/fog-loop.mp4']);
  });

  it('builds the look anyway when the clip is missing, and says which', async () => {
    const { builder, installScene } = builderFor(patch({ id: 'n1', kind: 'Noise', params: {} }));

    const report = await builder.build(
      { ...manifest, looks: [{ ...manifest.looks[0], media: ['smoke.mp4'] }] },
      { folder: FOLDER }
    );

    expect(installScene).toHaveBeenCalled();
    expect(report.problems.some((p) => /no clip in the folder called "smoke.mp4"/.test(p.message))).toBe(true);
  });

  it('changes nothing about a build with no folder', async () => {
    const { builder, generatePatch, installScene } = builderFor(patch({ id: 'n1', kind: 'Noise', params: {} }));

    await builder.build(manifest);

    expect(generatePatch.mock.calls[0][0]).not.toMatch(/Texture2D/);
    expect(generatePatch.mock.calls[0][1].media).toEqual([]);
    expect(installScene.mock.calls[0][2].textures).toEqual({});
  });
});

/* -------------------------------------------------------------------------
 * The backend half.
 *
 * A generated patch may not contain a texture node, because a model cannot
 * supply a file and a node pointing at nothing renders black. A show built from
 * a folder is the one case where the file exists before the call is made — so
 * the ban lifts exactly there, and exactly as far as the clips the artist
 * actually supplied.
 * ---------------------------------------------------------------------- */

describe('a generated patch holding a texture', () => {
  const answer = (...extra) => ({
    nodes: [
      { id: 'uv', kind: 'UV', x: 0, y: 0, params: {} },
      ...extra,
      { id: 'out', kind: 'OutputFinal', x: 0, y: 0, params: {} },
    ],
    connections: [],
  });

  const clip = (id, name) => ({ id, kind: 'Texture2D', x: 0, y: 0, name, params: {} });

  it('is still refused outright for every call that supplied no media', () => {
    // The editor's own generator button, which is nearly every call here.
    expect(() => validateGeneratedPatch(answer(clip('t1', 'Media: fog-loop'))))
      .toThrow(/needs a file you choose/);
  });

  it('is allowed when the caller has the clips loaded and waiting', () => {
    const { patch } = validateGeneratedPatch(answer(clip('t1', 'Media: fog-loop')), { mediaSlots: 1 });
    expect(patch.nodes.some((node) => node.kind === 'Texture2D')).toBe(true);
    // The name is the contract with attachMedia(), so it has to survive.
    expect(patch.nodes.find((node) => node.kind === 'Texture2D').name).toBe('Media: fog-loop');
  });

  it('allows a spare node or two, because a clip used twice is a composition', () => {
    expect(() => validateGeneratedPatch(answer(clip('t1', 'a'), clip('t2', 'b')), { mediaSlots: 1 }))
      .not.toThrow();
  });

  it('refuses a patch asking for far more footage than anyone supplied', () => {
    const many = answer(clip('t1', 'a'), clip('t2', 'b'), clip('t3', 'c'), clip('t4', 'd'), clip('t5', 'e'));
    expect(() => validateGeneratedPatch(many, { mediaSlots: 1 })).toThrow(/renders black/);
  });
});

describe('the prompt the backend writes for a look with media', () => {
  const show = { context: 'Show: Night set', look: 'Opening' };

  it('is byte-for-byte unchanged when no media was supplied', () => {
    const without = buildUserMessage('ai.patch_generator', { prompt: 'fog', show });
    const empty = buildUserMessage('ai.patch_generator', { prompt: 'fog', show: { ...show, media: [] } });
    expect(empty).toBe(without);
    expect(without).not.toMatch(/Texture2D/);
  });

  it('names the nodes, and forbids any other texture node', () => {
    const message = buildUserMessage('ai.patch_generator', {
      prompt: 'fog',
      show: { ...show, media: [{ node: 'Media: fog-loop', kind: 'video' }] },
    });

    expect(message).toContain('a Texture2D node named "Media: fog-loop" — moving footage');
    expect(message).toMatch(/Add no other Texture2D or TextureCube node/);
  });

  it('is not fooled by junk where the media should be', () => {
    for (const junk of [null, 'a clip', 42, [null], [{ node: {} }]]) {
      expect(() => buildUserMessage('ai.patch_generator', { prompt: 'x', show: { ...show, media: junk } }))
        .not.toThrow();
    }
  });
});
