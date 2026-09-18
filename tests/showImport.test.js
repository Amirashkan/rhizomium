// Reading a show out of a folder another tool wrote.
//
// Two things are being protected here. One is the artist who opens a folder
// full of somebody else's manifest.json files and is handed a page of errors
// about a document they never wrote. The other is the artist who opens a folder
// of generated pieces and should get a set out of it — the briefs, the clips,
// the palette and the holds — rather than an empty show.

import { describe, it, expect } from 'vitest';
import {
  manifestFromTransmissions,
  manifestKind,
  lookFromTransmission,
  readFolderShow,
} from '../src/performer/ShowImport.js';
import { validateManifest } from '../src/performer/ShowManifest.js';
import { scenarioFromManifest } from '../src/performer/ShowBuilder.js';
import { normalizeScenario, validateScenario } from '../src/performer/Scenario.js';
import { ActionExecutor } from '../src/performer/ActionExecutor.js';
import { directLooks } from '../src/performer/ShowBuilder.js';
import { activeDirection } from '../src/performer/PreDirections.js';
import { indexShowFolder, resolveLookMedia, resolveLookSound } from '../src/performer/ShowFolder.js';

/** One transmission's manifest, as `transmissions` writes it. */
const transmission = (overrides = {}) => ({
  manifest_version: 1,
  generated_at: '2026-09-14T04:00:00+00:00',
  slug: 'lattice-that-remembers',
  title: 'The lattice that remembers',
  source: { title: 'A crystal that holds a shape', url: 'https://example.org/1' },
  copy: {
    brief: 'Researchers report a lattice that returns to a stored configuration.',
    key_facts: ['It holds the shape for days.'],
    vignette: 'She presses her thumb into the pane and the window keeps it until morning.',
    narration: 'A pane of glass that remembers the weight of a hand, '
      + 'and gives it back to whoever comes looking in the morning light.',
  },
  media_briefs: {
    image: { prompt: 'Frost blooming across dark glass', aspect_ratio: '16:9', style_tags: ['cold'] },
    music: { prompt: 'A low bed', mood: 'hushed awe', bpm: 62, duration_seconds: 48, instrumental: true },
    video: {
      prompt: 'Interference fringes drifting over coarse grain, slow bloom from the lower edge',
      camera: 'slow dolly-in',
      aspect_ratio: '16:9',
      duration_seconds: 8,
    },
  },
  performance: {
    energy: 2,
    key: 'D dorian',
    palette: ['near-black', 'sodium orange'],
    texture: 'frost creeping across a dark pane',
    transition_in: 'fade up from black under the previous bed',
    transition_out: 'let it seep away',
  },
  assets: [
    { kind: 'image', provider: 'stability', path: 'image.png', status: 'ok' },
    { kind: 'video', provider: 'runway', path: 'video.mp4', status: 'ok' },
    { kind: 'music', provider: 'musicapi', path: 'music.mp3', status: 'ok' },
    { kind: 'voiceover', provider: 'elevenlabs', path: 'narration.mp3', status: 'ok' },
    { kind: 'sfx', provider: 'manual', path: null, status: 'manual' },
  ],
  ...overrides,
});

/** A file as a directory handle gives one over. */
const file = (name, body = '', { type = '', size = 1024 } = {}) => ({
  name,
  type,
  size,
  text: async () => body,
});

const manifestFile = (path, data) => ({ path, file: file(path.split('/').pop(), JSON.stringify(data)) });

describe('manifestKind', () => {
  it('calls anything with looks, scenes or sections a show — including an empty one', () => {
    expect(manifestKind({ show: 'Night set', looks: [{ brief: 'fog' }] })).toBe('show');
    expect(manifestKind({ sections: [] })).toBe('show');
  });

  it('knows a transmission by its version and what it carries', () => {
    expect(manifestKind(transmission())).toBe('transmission');
  });

  it('leaves everything else alone rather than coercing it into a show', () => {
    // The case that started this: a manifest.json that belongs to something
    // else entirely. Coerced, it is a show with no looks in it.
    expect(manifestKind({ name: 'app', short_name: 'app', icons: [] })).toBe('unknown');
    expect(manifestKind({ manifest_version: 1 })).toBe('unknown');
    expect(manifestKind(null)).toBe('unknown');
    expect(manifestKind([1, 2])).toBe('unknown');
  });
});

describe('lookFromTransmission', () => {
  it('builds the brief out of the prompts the piece was generated from', () => {
    const look = lookFromTransmission(transmission(), { path: '2026-09-14-lattice/manifest.json' });

    // The video prompt, because a look moves — and the texture, because it is
    // the one line saying what the abstraction is physically made of.
    expect(look.brief).toContain('Interference fringes drifting over coarse grain');
    expect(look.brief).toContain('Made of frost creeping across a dark pane');
    // Not the copy: the brief is the news and the vignette is fiction about a
    // person in a room. Neither describes an image.
    expect(look.brief).not.toContain('She presses her thumb');
    expect(look.brief).not.toContain('Researchers report');
  });

  it('does not say the texture twice when the prompt already said it', () => {
    // Both fields are written by the same model in the same pass, and they
    // often agree word for word.
    const same = transmission({
      media_briefs: { video: { prompt: 'Interference fringes drifting over coarse grain' } },
      performance: { energy: 3, texture: 'interference fringes drifting over coarse grain' },
    });

    expect(lookFromTransmission(same, { path: 'one/manifest.json' }).brief)
      .toBe('Interference fringes drifting over coarse grain.');
  });

  it('names the clips by a path from the top of the folder that was opened', () => {
    const look = lookFromTransmission(transmission(), { path: '2026-09-14-lattice/manifest.json' });

    expect(look.media).toEqual(['2026-09-14-lattice/media/video.mp4', '2026-09-14-lattice/media/image.png']);
  });

  it('names them from the project folder itself when that is what was picked', () => {
    const look = lookFromTransmission(transmission(), { path: 'manifest.json' });

    expect(look.media).toEqual(['media/video.mp4', 'media/image.png']);
  });

  it('leaves out an asset that was never generated', () => {
    const look = lookFromTransmission(transmission(), { path: 'one/manifest.json' });

    // The sfx is a prompt and no file. Naming it would be a look built around
    // a clip that is not there.
    expect(look.media.join(' ')).not.toContain('sfx');
    expect(look.notes).not.toContain('sfx');
  });

  it('carries energy across as an intensity, and the sound as a note', () => {
    const look = lookFromTransmission(transmission(), { path: 'one/manifest.json' });

    expect(look.intensity).toBe(0.25); // 2 of 5
    expect(look.mood).toBe('hushed awe, frost creeping across a dark pane');
    expect(look.notes).toContain('Key: D dorian');
    // The half of the folder the editor does not play, named so it can be found.
    expect(look.notes).toContain('music: one/media/music.mp3');
    expect(look.notes).toContain('voiceover: one/media/narration.mp3');
  });

  it('holds for the bed, and never for less than the narration takes to say', () => {
    const short = lookFromTransmission(
      transmission({ media_briefs: { ...transmission().media_briefs, music: { bpm: 60, duration_seconds: 20 } } }),
      { path: 'one/manifest.json' }
    );

    // 26 words at 2.5/s is ~10s, plus 8s of air, so the floor still wins here.
    expect(short.hold.seconds).toBe(30);

    const talky = lookFromTransmission(
      transmission({ copy: { narration: 'word '.repeat(200) } }),
      { path: 'one/manifest.json' }
    );
    expect(talky.hold.seconds).toBeGreaterThan(80);
  });

  it('plays the piece its own bed, and leaves the narration to the artist', () => {
    const look = lookFromTransmission(transmission(), { path: 'one/manifest.json' });

    // The bed is the file holdOf() measured this look's length from, so the
    // section and the track under it are the same length by construction.
    expect(look.sound).toBe('one/media/music.mp3');
    // One element behind the analysis: a voice over the bed is a mix the
    // artist makes in their own software, not a second file chosen for them.
    expect(look.notes).toContain('voiceover: one/media/narration.mp3');
  });

  it('has no bed when the piece never generated one', () => {
    const silent = transmission({
      assets: [{ kind: 'image', provider: 'stability', path: 'image.png', status: 'ok' }],
    });

    expect(lookFromTransmission(silent, { path: 'one/manifest.json' }).sound).toBe('');
  });

  it('is still a look when the piece says almost nothing about itself', () => {
    const look = lookFromTransmission({ manifest_version: 1, title: 'Bare' }, { path: 'bare/manifest.json' });

    expect(look.id).toBe('bare');
    expect(look.name).toBe('Bare');
    expect(look.brief).toBe('Bare');
    expect(look.media).toEqual([]);
  });
});

describe('manifestFromTransmissions', () => {
  /** The same three, as readFolderShow() would have parsed them. */
  const parsed = () => [
    {
      path: '2026-09-16-third/manifest.json',
      data: transmission({ slug: 'third', title: 'Third', performance: { energy: 5, palette: ['bone white'], texture: 'ash' } }),
    },
    { path: '2026-09-14-first/manifest.json', data: transmission({ slug: 'first', title: 'First' }) },
    {
      path: '2026-09-15-second/manifest.json',
      data: transmission({ slug: 'second', title: 'Second', media_briefs: { music: { bpm: 120, duration_seconds: 60 } } }),
    },
  ];

  it('puts the set in the folder\'s own order, not the order they were read in', () => {
    const { manifest } = manifestFromTransmissions(parsed(), { name: 'Transmissions' });

    // Project folders are date-stamped, so the path order is the order they
    // were made in — which is the only order anything here knows about.
    expect(manifest.looks.map((look) => look.name)).toEqual(['First', 'Second', 'Third']);
    expect(manifest.name).toBe('Transmissions');
  });

  it('writes a show that builds: no errors, every look with a brief and a clip', () => {
    const { manifest } = manifestFromTransmissions(parsed(), { name: 'Transmissions' });
    const report = validateManifest(manifest);

    expect(report.errors).toEqual([]);
    expect(report.generated).toBe(3);
    expect(manifest.looks.every((look) => look.brief && look.media.length)).toBe(true);
  });

  it('answers the warnings an empty show would have raised', () => {
    const { manifest } = manifestFromTransmissions(parsed());
    const report = validateManifest(manifest);
    const where = report.warnings.map((w) => w.where);

    // These four are exactly what a folder with nothing in the editor used to
    // come back with, and every one of them is answered from the manifests.
    expect(where).not.toContain('cues');
    expect(where).not.toContain('signals');
    expect(where).not.toContain('brief');
    expect(where).not.toContain('media');
  });

  it('takes the median tempo and writes the set in seconds', () => {
    const { manifest } = manifestFromTransmissions(parsed());

    expect(manifest.bpm).toBe(62); // 62, 62, 120
    // Ambient beds with no usable pulse: nothing in the set is counted in bars.
    expect(manifest.pulse).toBe('free');
    expect(manifest.looks.every((look) => look.hold.seconds > 0)).toBe(true);
    expect(manifest.looks.some((look) => look.hold.bars)).toBe(false);
  });

  it('gathers one palette for the whole show, said once', () => {
    const { manifest } = manifestFromTransmissions(parsed());

    expect(manifest.palette).toBe('near-black, sodium orange, bone white');
  });

  it('loops the last look back to the first, and names a cue per piece', () => {
    const { manifest } = manifestFromTransmissions(parsed());
    const ids = manifest.looks.map((look) => look.id);

    expect(manifest.looks.map((look) => look.next)).toEqual([ids[1], ids[2], ids[0]]);
    expect(manifest.cues).toEqual(ids);
  });

  it('keeps two pieces that slug the same as two looks', () => {
    const { manifest } = manifestFromTransmissions([
      { path: 'a/manifest.json', data: transmission({ slug: 'same', title: 'One' }) },
      { path: 'b/manifest.json', data: transmission({ slug: 'same', title: 'Two' }) },
    ]);

    expect(manifest.looks.map((look) => look.id)).toEqual(['same', 'same-2']);
    // And `next` points at the id the second look actually ended up with.
    expect(manifest.looks[0].next).toBe('same-2');
  });

  it('stops at what one build can hold, and says why', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      path: `2026-09-${String(i + 1).padStart(2, '0')}-piece/manifest.json`,
      data: transmission({ slug: `piece-${i + 1}`, title: `Piece ${i + 1}` }),
    }));

    const { manifest, problems } = manifestFromTransmissions(many);

    expect(manifest.looks).toHaveLength(12);
    expect(problems[0].message).toMatch(/15 transmissions here/);
  });

  it('names clips the folder can actually resolve', () => {
    // The whole point of the media list: the path it writes has to find the
    // file. Indexed the way the picker would hand the folder over.
    const folder = indexShowFolder([
      { path: '2026-09-14-first/manifest.json', file: file('manifest.json') },
      { path: '2026-09-14-first/media/video.mp4', file: file('video.mp4', '', { type: 'video/mp4' }) },
      { path: '2026-09-14-first/media/image.png', file: file('image.png', '', { type: 'image/png' }) },
      { path: '2026-09-14-first/media/music.mp3', file: file('music.mp3', '', { type: 'audio/mpeg' }) },
    ]);

    const { manifest } = manifestFromTransmissions([
      { path: '2026-09-14-first/manifest.json', data: transmission({ slug: 'first' }) },
    ]);

    const { items, missing } = resolveLookMedia(folder, manifest.looks[0]);
    expect(missing).toEqual([]);
    expect(items.map((item) => item.name)).toEqual(['video.mp4', 'image.png']);

    // And the bed, by the same path, out of the same index.
    expect(resolveLookSound(folder, manifest.looks[0]).name).toBe('music.mp3');
  });
});

describe('readFolderShow', () => {
  const read = (entries) => readFolderShow(indexShowFolder(entries, { name: 'Transmissions' }));

  it('opens a show manifest as its own bytes, so saving puts back what was opened', async () => {
    const body = '{\n  "show": "Night set",\n  "looks": []\n}';
    const result = await read([{ path: 'night.rzshow.json', file: file('night.rzshow.json', body) }]);

    expect(result.kind).toBe('show');
    expect(result.text).toBe(body);
    expect(result.path).toBe('night.rzshow.json');
  });

  it('reads a folder of project folders as one show', async () => {
    const result = await read([
      manifestFile('2026-09-14-first/manifest.json', transmission({ slug: 'first', title: 'First' })),
      { path: '2026-09-14-first/media/video.mp4', file: file('video.mp4', '', { type: 'video/mp4' }) },
      manifestFile('2026-09-15-second/manifest.json', transmission({ slug: 'second', title: 'Second' })),
      { path: '2026-09-15-second/media/video.mp4', file: file('video.mp4', '', { type: 'video/mp4' }) },
    ]);

    expect(result.kind).toBe('transmissions');
    expect(result.projects).toHaveLength(2);
    expect(JSON.parse(result.text).looks.map((look) => look.name)).toEqual(['First', 'Second']);
    // Two manifests in the folder is the shape of this, not a complaint.
    expect(result.problems.some((p) => /More than one manifest/.test(p.message))).toBe(false);
  });

  it('reads one project folder as a one-look show', async () => {
    const result = await read([
      manifestFile('manifest.json', transmission()),
      { path: 'media/image.png', file: file('image.png', '', { type: 'image/png' }) },
    ]);

    expect(result.kind).toBe('transmissions');
    expect(result.manifest.looks).toHaveLength(1);
  });

  it('leaves a manifest that is not a show alone, and says so', async () => {
    const result = await read([
      { path: 'manifest.json', file: file('manifest.json', JSON.stringify({ name: 'something else', icons: [] })) },
    ]);

    expect(result.kind).toBe('none');
    expect(result.text).toBe('');
    expect(result.problems[0].message).toMatch(/is not a show/);
  });

  it('prefers the show manifest when the folder holds both', async () => {
    const result = await read([
      manifestFile('set.rzshow.json', { show: 'Mine', looks: [{ name: 'One', brief: 'fog over the room' }] }),
      manifestFile('2026-09-14-first/manifest.json', transmission()),
    ]);

    expect(result.kind).toBe('show');
    expect(result.problems.some((p) => /ignoring 2026-09-14-first/.test(p.message))).toBe(true);
  });

  it('says which file could not be read rather than failing the folder', async () => {
    const broken = {
      path: 'manifest.json',
      file: { name: 'manifest.json', size: 10, type: '', text: async () => { throw new Error('gone'); } },
    };
    const result = await read([broken]);

    expect(result.kind).toBe('none');
    expect(result.problems[0].message).toMatch(/could not be read: gone/);
  });

  it('says which file is not JSON rather than failing the folder', async () => {
    const result = await read([{ path: 'show.json', file: file('show.json', 'half a file {') }]);

    expect(result.kind).toBe('none');
    expect(result.problems[0].message).toMatch(/not valid JSON/);
  });

  it('is nothing at all for a folder with no manifest in it', async () => {
    const result = await read([{ path: 'media/fog.mp4', file: file('fog.mp4', '', { type: 'video/mp4' }) }]);

    expect(result.kind).toBe('none');
    expect(result.problems).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// The whole trip, for the case this file exists for: a folder another tool
// wrote, opened, built into a set, and played. Every step is the real one
// except the model that would write the patches — what is under test is that a
// bed in that folder is a bed coming out of the machine, which is a chain of
// five files agreeing on one filename.
// --------------------------------------------------------------------------

describe('a folder of transmissions, end to end', () => {
  it('plays the piece its own bed when the section it belongs to starts', async () => {
    const entries = [
      manifestFile('2026-09-16-cortex-vacancy/manifest.json', transmission({ slug: 'cortex-vacancy', title: 'The Cortex Vacancy' })),
      { path: '2026-09-16-cortex-vacancy/media/video.mp4', file: file('video.mp4', '', { type: 'video/mp4' }) },
      { path: '2026-09-16-cortex-vacancy/media/music.mp3', file: file('music.mp3', '', { type: 'audio/mpeg' }) },
      { path: '2026-09-16-cortex-vacancy/media/narration.mp3', file: file('narration.mp3', '', { type: 'audio/mpeg' }) },
    ];
    const folder = indexShowFolder(entries, { name: 'Transmissions' });
    const show = await readFolderShow(folder);

    // The set the panel would write from that manifest, with the scene the
    // build would have installed.
    const scenario = normalizeScenario(
      scenarioFromManifest(show.manifest, [{ lookId: show.manifest.looks[0].id, sceneName: 'The Cortex Vacancy' }])
    );

    const loaded = [];
    const executor = new ActionExecutor({
      editor: { graph: { nodes: [] } },
      audioDeck: {
        describe: () => ({ file: '', loaded: false, playing: false, live: null, position: 0 }),
        load: async (f, name) => { loaded.push(name); },
        play: async () => ({ ok: true }),
        pause() {}, stop() {}, seek() {},
      },
    });
    executor.setSounds(folder.media);

    const enter = scenario.sections[0].onEnter.find((action) => action.type === 'audio');
    expect(enter.clip).toBe('2026-09-16-cortex-vacancy/media/music.mp3');
    expect(executor.execute(enter, { now: 0 }).ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loaded).toEqual(['music.mp3']);

    // And the section is exactly as long as the bed it plays: the manifest's
    // hold came off the same file.
    expect(scenario.sections[0].hold.seconds).toBe(48);
  });
});

// Direction, on a show that came out of a folder rather than off a desk.
//
// This is the case pre-directions exist for: generated, ambient, and played by
// the model with nobody standing over it. A set of transmissions that arrived
// undirected would be improvised for its whole length, so what matters here is
// that nothing has to be regenerated or typed for it to arrive directed — the
// energy every transmission already carries is what it is derived from.
describe('a transmissions show, directed', () => {
  it('gives every look a direction the live model can act on', () => {
    const look = lookFromTransmission(transmission(), { path: 'p/manifest.json' });
    expect(look.direction).toBeTruthy();
    // Energy 2 in the fixture: patient, and told not to brighten.
    expect(look.direction).toMatch(/patient/i);
  });

  it('says how much to move by the energy the piece was written at', () => {
    const quiet = lookFromTransmission(
      transmission({ performance: { energy: 1, texture: 'grain' } }), { path: 'a/manifest.json' });
    const loud = lookFromTransmission(
      transmission({ performance: { energy: 5, texture: 'grain' } }), { path: 'b/manifest.json' });

    expect(quiet.direction).toMatch(/hold it/i);
    expect(loud.direction).toMatch(/densest point/i);
    expect(quiet.direction).not.toBe(loud.direction);
  });

  it('does not tell the loudest piece to do what this material will not do', () => {
    // Half an hour in a dark room. A strobe or a full-white frame is not a set
    // going hard, it is a set breaking — and the top of the energy scale is the
    // one line most likely to cross that, so it carries the rule itself.
    const loud = lookFromTransmission(
      transmission({ performance: { energy: 5, texture: 'grain' } }), { path: 'b/manifest.json' });
    expect(loud.direction).toMatch(/no strobe/i);
    expect(loud.direction).toMatch(/no white frame/i);
  });

  it('carries the arranger\'s transition_out, which nothing else would think about', () => {
    const look = lookFromTransmission(
      transmission({ performance: { energy: 3, transition_out: 'Let it seep away' } }),
      { path: 'p/manifest.json' }
    );
    expect(look.direction).toMatch(/let it seep away/);
  });

  it('does not simply repeat the mood it already sends', () => {
    // The director is shown both. A direction that restates the mood wastes
    // the one line it gets.
    const look = lookFromTransmission(transmission(), { path: 'p/manifest.json' });
    expect(look.direction).not.toBe(look.mood);
  });

  it('is written for a piece with no performance block at all', () => {
    const look = lookFromTransmission({ title: 'Bare' }, { path: 'p/manifest.json' });
    expect(look.direction).toBeTruthy();
  });

  it('puts a standing direction on the show, said once', () => {
    const { manifest } = manifestFromTransmissions([
      { path: 'a/manifest.json', data: transmission({ slug: 'one' }) },
      { path: 'b/manifest.json', data: transmission({ slug: 'two' }) },
    ]);
    expect(manifest.direction).toMatch(/dark room/i);
    // The two rules the material will not break, said where the model is
    // deciding rather than in a brief it was shown once.
    expect(manifest.direction).toMatch(/never let a look become an object/i);
    expect(manifest.direction).toMatch(/never strobe or go white/i);
  });

  it('no longer warns that the show has no direction in it', () => {
    // The warning added with pre-directions fires on an undirected show, and a
    // folder read from another tool is the one nobody could have typed into.
    const { manifest } = manifestFromTransmissions([
      { path: 'a/manifest.json', data: transmission() },
    ]);
    const report = validateManifest(manifest);
    expect(report.warnings.some((w) => w.where === 'direction')).toBe(false);
  });

  it('lands on the built set, one live line per section', () => {
    // End to end: folder in, and every section of the set that comes out has
    // something to hand the director.
    const { manifest } = manifestFromTransmissions([
      { path: 'a/manifest.json', data: transmission({ slug: 'one', title: 'One' }) },
      { path: 'b/manifest.json', data: transmission({ slug: 'two', title: 'Two' }) },
    ]);
    const scenario = directLooks(scenarioFromManifest(manifest), manifest);

    for (const section of scenario.sections) {
      const live = activeDirection(scenario.directions, {
        sectionId: section.id, sectionSeconds: 0,
      });
      expect(live, section.id).not.toBe(null);
      expect(live.text).toBeTruthy();
    }
  });
});

// The other route in: a scenario `transmissions perform` exported, loaded
// straight into the panel's Scenario tab with no build in between.
//
// Reading the project folders as a show folder and exporting them as a scenario
// have to agree, because they are two ways of playing the same pieces — and
// this end is the one that can drift without anybody noticing, since the
// document is written by a program in another repository. The fixture below is
// what `transmissions/rhizomium.py::_directions()` writes, and its job is to
// fail here rather than at showtime if that changes shape.
describe('a scenario transmissions exported', () => {
  /** SET.rzperf.json, trimmed to the parts direction depends on. */
  const exported = () => ({
    version: 1,
    name: 'Transmissions — 30 minutes',
    bpm: 120,
    sections: [
      { id: 'opening-drone', name: 'Opening drone', enter: 'manual', hold: { seconds: 600 }, look: { scene: 'opening-drone' }, next: 'europa-returns' },
      { id: 'europa-returns', name: 'Europa returns', enter: 'manual', hold: { seconds: 600 }, look: { scene: 'europa-returns' }, next: 'opening-drone' },
    ],
    directions: [
      { id: 'set', at: { whole: true }, text: 'These are ambient pieces and there is nobody at the laptop: let each one hold.' },
      { id: 'dir-opening-drone', at: { section: 'opening-drone' }, text: 'Hold it. Almost nothing should move. Towards the end, let it seep away.' },
      { id: 'dir-europa-returns', at: { section: 'europa-returns' }, text: 'Let it go — full frame, hard. Towards the end, cut it dead.' },
    ],
    rules: { director: { enabled: true, everySeconds: 60, freedom: 0.25 } },
  });

  it('keeps its direction through the load', () => {
    const scenario = normalizeScenario(exported());
    expect(scenario.directions).toHaveLength(3);
    expect(scenario.directions[0].at.whole).toBe(true);
  });

  it('loads with nothing to report about it', () => {
    // A warning here is a warning about a document the artist did not write
    // and cannot fix, which is the failure ShowImport.js exists to avoid.
    const report = validateScenario(normalizeScenario(exported()));
    expect(report.errors).toEqual([]);
    expect(report.warnings.filter((w) => /pre-direction/.test(w.where))).toEqual([]);
  });

  it('hands the director that section\'s own line, in every section', () => {
    const scenario = normalizeScenario(exported());
    for (const section of scenario.sections) {
      const live = activeDirection(scenario.directions, {
        sectionId: section.id, sectionSeconds: 0,
      });
      expect(live, section.id).not.toBe(null);
      expect(live.at.section).toBe(section.id);
    }
  });

  it('falls back to the standing line in a section the export did not name', () => {
    // An artist who adds a section of their own to somebody else's set. It is
    // not left undirected.
    const raw = exported();
    raw.sections.push({ id: 'mine', name: 'Mine', enter: 'manual', hold: { seconds: 60 } });
    const scenario = normalizeScenario(raw);

    const live = activeDirection(scenario.directions, { sectionId: 'mine', sectionSeconds: 0 });
    expect(live.at.whole).toBe(true);
  });
});
