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
import { indexShowFolder, resolveLookMedia } from '../src/performer/ShowFolder.js';

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
