// An episode, read out of the folder another tool wrote.
//
// A show folder used to be a pool: every project in it became a look, in
// whatever order the folder listed them, and the set wrapped round when it ran
// out. An episode is the other thing — a running order somebody decided, an
// opening, a sign-off, and an end. Three things are being protected here.
//
// The artist who already has this working: a folder holding a .rzshow.json must
// keep resolving to it, byte for byte, because that document is better than
// anything reconstructed from the cue folders beside it.
//
// The artist whose episode should end: a sign-off that hands back to the
// opening is a loop with a preamble, and it is the one way an episode differs
// from every other show this panel opens.
//
// And the artist's account: the two ends are words on black, drawn from their
// own strings. A build of a four-cue episode is four calls, not six.

import { describe, it, expect, vi } from 'vitest';
import {
  manifestFromTransmissions,
  manifestKind,
  readFolderShow,
} from '../src/performer/ShowImport.js';
import { normalizeManifest, validateManifest } from '../src/performer/ShowManifest.js';
import { normalizeScenario, validateScenario } from '../src/performer/Scenario.js';
import { indexShowFolder } from '../src/performer/ShowFolder.js';
import { ShowBuilder, ensureUnattended } from '../src/performer/ShowBuilder.js';
import {
  endCardPatch, cardText, wrapCard, MAX_CARD_CHARS, RESOLUTION,
} from '../src/performer/EndCard.js';

/** About fifty words — what an opening is written to, and read in twenty seconds. */
const OPENING = Array.from({ length: 50 }, () => 'word').join(' ');
const SIGNOFF = 'That is what was found. The room is yours again.';

/** One transmission's manifest, as `transmissions` writes it now. */
const transmission = (overrides = {}) => ({
  manifest_version: 1,
  slug: 'lattice-that-remembers',
  title: 'The lattice that remembers',
  material: 'frost creeping across a dark pane',
  copy: {
    brief: 'Researchers report a lattice that returns to a stored configuration.',
    // Two reads, in two voices, which is the shape that broke the holds.
    narration: {
      brief: Array.from({ length: 45 }, () => 'reported').join(' '),
      vignette: Array.from({ length: 45 }, () => 'scene').join(' '),
    },
  },
  media_briefs: {
    image: { prompt: 'Frost blooming across dark glass', aspect_ratio: '16:9' },
    music: { prompt: 'A low bed', mood: 'hushed awe', bpm: 62, duration_seconds: 35 },
    video: { prompt: 'Interference fringes drifting over coarse grain', duration_seconds: 8 },
  },
  performance: { energy: 2, key: 'D dorian', palette: ['near-black', 'sodium orange'] },
  assets: [
    { kind: 'video', provider: 'runway', path: 'video.mp4', status: 'ok' },
    { kind: 'voiceover-brief', provider: 'openai-tts', path: 'voiceover-brief.mp3', status: 'ok' },
    { kind: 'voiceover-vignette', provider: 'openai-tts', path: 'voiceover-vignette.mp3', status: 'ok' },
  ],
  ...overrides,
});

/** An episode's manifest, as `transmissions episode` writes it. */
const episode = (overrides = {}) => ({
  episode_version: 1,
  slug: '2026-09-19-ep-001',
  number: 1,
  title: 'Four Things Found Out',
  minutes: 12,
  order: ['charlie', 'alpha', 'bravo'],
  opening: {
    text: OPENING,
    assets: [{ kind: 'voiceover-opening', path: 'voiceover-opening.mp3', status: 'ok' }],
  },
  signoff: {
    text: SIGNOFF,
    assets: [{ kind: 'voiceover-signoff', path: 'voiceover-signoff.mp3', status: 'ok' }],
  },
  ...overrides,
});

const file = (name, body = '', { type = '', size = 1024 } = {}) => ({
  name, type, size, text: async () => body,
});

const manifestFile = (path, data) => ({ path, file: file(path.split('/').pop(), JSON.stringify(data)) });

const read = (entries) => readFolderShow(indexShowFolder(entries, { name: 'ep-001' }));

/** An episode folder: the episode, three cue folders, and the host's two reads. */
const FOLDER = [
  manifestFile('episode.json', episode()),
  manifestFile('charlie/manifest.json', transmission({ slug: 'charlie', title: 'Charlie' })),
  manifestFile('alpha/manifest.json', transmission({ slug: 'alpha', title: 'Alpha' })),
  manifestFile('bravo/manifest.json', transmission({ slug: 'bravo', title: 'Bravo' })),
  { path: 'media/voiceover-opening.mp3', file: file('voiceover-opening.mp3', '', { type: 'audio/mpeg' }) },
  { path: 'media/voiceover-signoff.mp3', file: file('voiceover-signoff.mp3', '', { type: 'audio/mpeg' }) },
];

// -- what kind of document it is -------------------------------------------

describe('manifestKind', () => {
  it('knows an episode from its own version and its running order', () => {
    expect(manifestKind(episode())).toBe('episode');
    expect(manifestKind({ episode_version: 1, opening: { text: 'hi' } })).toBe('episode');
  });

  it('will not call a bare version field an episode', () => {
    // Any tool might write a version number. Two tests, or a stray document
    // becomes the show.
    expect(manifestKind({ episode_version: 1 })).toBe('unknown');
  });

  it('still knows the other two', () => {
    expect(manifestKind(transmission())).toBe('transmission');
    expect(manifestKind({ looks: [] })).toBe('show');
  });
});

// -- the folder ------------------------------------------------------------

describe('readFolderShow, on an episode folder', () => {
  it('leaves a folder that has its own show manifest alone', async () => {
    // The document the other tool wrote is better than anything rebuilt from
    // the cue folders: its briefs are written from each cue's own material and
    // its holds are counted against the running time. It must keep winning.
    const withShow = [...FOLDER, manifestFile('four-things.rzshow.json', { show: 'Four Things', looks: [] })];

    const result = await read(withShow);
    expect(result.kind).toBe('show');
    expect(result.path).toBe('four-things.rzshow.json');
  });

  it('reads the episode when there is no show manifest beside it', async () => {
    const result = await read(FOLDER);

    expect(result.kind).toBe('episode');
    expect(result.path).toBe('episode.json');
    expect(result.episode).toEqual({
      number: 1, title: 'Four Things Found Out', minutes: 12, cues: 3,
    });
    expect(result.manifest.name).toBe('Four Things Found Out');
  });

  it('plays the cues in the order the episode decided, not the order the folder lists', async () => {
    // Alphabetically these are alpha, bravo, charlie. The episode wants them
    // the other way round, and the opening names them in that order.
    const result = await read(FOLDER);
    const cues = result.manifest.looks.filter((look) => !look.card);

    expect(cues.map((look) => look.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('keeps a cue the running order has never heard of', async () => {
    const withStray = [
      ...FOLDER,
      manifestFile('delta/manifest.json', transmission({ slug: 'delta', title: 'Delta' })),
    ];
    const result = await read(withStray);
    const cues = result.manifest.looks.filter((look) => !look.card);

    // At the end, in folder position. Dropping it would be the worst possible
    // way to find out it was there.
    expect(cues.map((look) => look.name)).toEqual(['Charlie', 'Alpha', 'Bravo', 'Delta']);
  });

  it('opens and closes on the show\'s own words', async () => {
    const result = await read(FOLDER);
    const { looks } = result.manifest;

    expect(looks[0].id).toBe('intro');
    expect(looks[0].card).toBe(OPENING);
    expect(looks[looks.length - 1].id).toBe('outro');
    expect(looks[looks.length - 1].card).toBe(SIGNOFF);
    // Words, not a brief: there is nothing to generate for either end.
    expect(looks[0].brief).toBe('');
  });

  it('runs once and stops on the sign-off', async () => {
    const result = await read(FOLDER);
    const { looks } = result.manifest;

    expect(result.manifest.runsOnce).toBe(true);
    // Straight through, and the last one points nowhere.
    expect(looks[looks.length - 1].next).toBe('');
    expect(looks[0].next).toBe(looks[1].id);
  });

  it('is a show a build will accept', async () => {
    const result = await read(FOLDER);
    const report = validateManifest(result.manifest);

    // A look that is only words used to be an error — "needs a brief or a
    // scene" — which would have failed the build on the first section.
    expect(report.errors).toEqual([]);
    // And only the cues cost anything.
    expect(report.generated).toBe(3);
  });

  it('says so when an episode has no transmissions beside it', async () => {
    const result = await read([manifestFile('episode.json', episode({ order: [] }))]);

    expect(result.kind).toBe('episode');
    expect(result.problems.some((p) => /no transmissions/.test(p.message))).toBe(true);
  });
});

// -- the holds -------------------------------------------------------------

describe('how long an episode holds', () => {
  it('gives an end long enough to finish speaking', async () => {
    const result = await read(FOLDER);
    const intro = result.manifest.looks[0];

    // Fifty words at two and a half a second is twenty seconds, which is
    // exactly the length an intro states. Taken literally the show would be cut
    // off on its own first sentence.
    expect(intro.hold.seconds).toBeGreaterThan(20);
  });

  it('counts both of a cue\'s reads, not neither', async () => {
    // `copy.narration` became {brief, vignette} and this stopped being a string.
    // Nothing failed — the hold just quietly collapsed to the bed's length.
    const bare = manifestFromTransmissions(
      [{ path: 'one/manifest.json', data: transmission() }], {}
    );
    const hold = bare.manifest.looks[0].hold.seconds;

    // 90 words of narration is 36 seconds spoken, plus air. The bed is 35.
    expect(hold).toBeGreaterThan(40);
  });

  it('spends the running time the episode was written for', async () => {
    const result = await read(FOLDER);
    const total = result.manifest.looks.reduce((sum, look) => sum + look.hold.seconds, 0);

    // Twelve minutes, to the second the rounding allows. Without this a
    // twelve-minute episode comes back as four, which is not the show.
    expect(total).toBeGreaterThan(12 * 60 - 5);
    expect(total).toBeLessThanOrEqual(12 * 60);
  });

  it('never cuts a cue shorter than its own narration', async () => {
    const result = await read([
      manifestFile('episode.json', episode({ minutes: 1, order: ['alpha'] })),
      manifestFile('alpha/manifest.json', transmission({ slug: 'alpha' })),
    ]);
    const cue = result.manifest.looks.find((look) => !look.card);

    // A minute split three ways is shorter than this cue speaks for. The share
    // is a floor to raise to, never a ceiling to cut at.
    expect(cue.hold.seconds).toBeGreaterThan(40);
  });
});

// -- a pool is still a pool ------------------------------------------------

describe('a folder with no episode in it', () => {
  const pool = [
    manifestFile('alpha/manifest.json', transmission({ slug: 'alpha', title: 'Alpha' })),
    manifestFile('bravo/manifest.json', transmission({ slug: 'bravo', title: 'Bravo' })),
  ];

  it('still wraps round, and still has no ends', async () => {
    const result = await read(pool);

    expect(result.kind).toBe('transmissions');
    expect(result.manifest.runsOnce).toBe(false);
    // The last look hands back to the first: a set that outlasts its material
    // loops rather than sitting on the last piece.
    const ids = result.manifest.looks.map((look) => look.id);
    expect(result.manifest.looks.map((look) => look.next)).toEqual([ids[1], ids[0]]);
    expect(result.manifest.looks.every((look) => !look.card)).toBe(true);
  });

  it('is read in folder order', async () => {
    const result = await read(pool);
    expect(result.manifest.looks.map((look) => look.name)).toEqual(['Alpha', 'Bravo']);
  });
});

// -- the cards -------------------------------------------------------------

describe('endCardPatch', () => {
  it('draws the words on opaque black', () => {
    const patch = endCardPatch('Four things found out this week.');
    const [text, output] = patch.nodes;

    expect(text.kind).toBe('Text');
    // The words, not the layout: the card is wrapped on the way in so that
    // autoFit has a block it can draw large. See wrapCard.
    expect(text.params.text.split(/\s+/)).toEqual('Four things found out this week.'.split(' '));
    // Alpha 1 behind the glyphs, or the card is words over whatever the last
    // look left on the screen.
    expect(text.params.background).toEqual([0, 0, 0, 1]);
    expect(output.kind).toBe('OutputFinal');
    // Both halves of a wire: the editor keeps the connection list and each
    // node's inputs array, and a patch filling one loads with a dead link.
    expect(output.inputs).toEqual([text.id]);
    expect(patch.connections).toEqual([
      { from: { nodeId: text.id, pin: 0 }, to: { nodeId: output.id, pin: 0 } },
    ]);
  });

  it('has nothing to draw for an end that says nothing', () => {
    expect(endCardPatch('')).toBeNull();
    expect(endCardPatch('   ')).toBeNull();
  });

  it('trims a card that is the whole show rather than a title', () => {
    const long = cardText('sediment '.repeat(200));
    expect(long.length).toBeLessThanOrEqual(MAX_CARD_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('building an episode', () => {
  const MANIFEST = {
    show: 'Ep 1',
    runsOnce: true,
    looks: [
      { id: 'intro', name: 'Opening', card: OPENING, hold: { seconds: 29 } },
      { id: 'one', name: 'One', brief: 'interference fringes over coarse grain, edge-lit' },
      { id: 'outro', name: 'Sign-off', card: SIGNOFF, hold: { seconds: 30 } },
    ],
  };

  const builder = (deps = {}) => {
    const installScene = vi.fn(async (name) => ({ id: name, name }));
    const generatePatch = vi.fn(async () => ({
      patch: { nodes: [{ id: 'n0', kind: 'Noise', params: {} }], connections: [] },
      title: 'A patch',
    }));
    return {
      installScene,
      generatePatch,
      show: new ShowBuilder({ installScene, generatePatch, ...deps }),
    };
  };

  it('spends a call on the cue and nothing on the two ends', async () => {
    const { show, installScene, generatePatch } = builder();
    const report = await show.build(MANIFEST);

    expect(generatePatch).toHaveBeenCalledTimes(1);
    // All three are installed — the ends are scenes too, they are just scenes
    // nobody paid for.
    expect(installScene).toHaveBeenCalledTimes(3);
    expect(report.built.map((one) => one.generated)).toEqual([false, false, true]);
  });

  it('installs the ends as a Text node on black', async () => {
    const { show, installScene } = builder();
    await show.build(MANIFEST);

    const [name, patch] = installScene.mock.calls[0];
    expect(name).toBe('Opening');
    expect(patch.nodes.map((node) => node.kind)).toEqual(['Text', 'OutputFinal']);
    expect(patch.nodes[0].params.text.split(/\s+/)).toEqual(OPENING.split(' '));
  });

  it('builds a show of nothing but ends with no AI at all', async () => {
    // A card is drawn from its own string, so there is nothing here to ask a
    // model for — and a locked door in front of an empty room is still locked.
    const installScene = vi.fn(async (name) => ({ id: name, name }));
    const show = new ShowBuilder({ installScene, generatePatch: null });

    const report = await show.build({
      show: 'Ends only',
      looks: MANIFEST.looks.filter((look) => look.card),
    });

    expect(installScene).toHaveBeenCalledTimes(2);
    expect(report.problems).toEqual([]);
  });

  it('still asks for the AI when something really does need generating', async () => {
    const show = new ShowBuilder({ installScene: async () => ({}), generatePatch: null });
    await expect(show.build(MANIFEST)).rejects.toThrow(/AI is not available/);
  });

  it('prefers a scene the artist already has over drawing a card', async () => {
    const { show, installScene } = builder();
    await show.build({
      show: 'Ep',
      looks: [{ id: 'intro', name: 'Opening', card: OPENING, scene: 'My own intro' }],
    });

    // Nothing drawn: the artist's picture beats ours, the same way a scene
    // already beats a brief.
    expect(installScene).not.toHaveBeenCalled();
  });
});

// -- and the set it makes --------------------------------------------------

describe('the scenario an episode makes', () => {
  it('carries the flag that lets it end', async () => {
    const { scenarioFromManifest } = await import('../src/performer/ShowBuilder.js');
    const set = scenarioFromManifest(normalizeManifest({
      show: 'Ep 1',
      runsOnce: true,
      looks: [
        { id: 'intro', name: 'Opening', card: OPENING },
        { id: 'one', name: 'One', brief: 'a thing made of grain' },
        { id: 'outro', name: 'Sign-off', card: SIGNOFF },
      ],
    }));

    expect(set.runsOnce).toBe(true);
    expect(set.sections.map((s) => s.next)).toEqual(['one', 'outro', '']);
  });

  it('leaves an ordinary show looping', async () => {
    const { scenarioFromManifest } = await import('../src/performer/ShowBuilder.js');
    const set = scenarioFromManifest(normalizeManifest({
      show: 'A set', looks: [{ id: 'one', name: 'One', brief: 'grain' }],
    }));

    expect(set.runsOnce).toBe(false);
  });
});

// -- making the words readable ---------------------------------------------
//
// The card was legible in the sense that it was on the screen. It was not
// legible in the sense that anyone could read it, and turning the font size up
// did nothing at all — which is the tell: the node's `autoFit` had already
// overridden `size`, because the block was too wide to fit and was being scaled
// down from whatever number it was given.

describe('wrapCard', () => {
  const OPENING_LINES = [
    "Bolivia's Yungas forest gives up a wild cat, newly named.",
    'Cleaner air is linked to better mental development in toddlers.',
    'Starship prepares for its first orbit around Earth, with satellites aboard.',
    'Black holes disclose when feeding turns to jets, and darkness remembers its poor manners.',
  ].join('\n');

  const longest = (text) => Math.max(...text.split('\n').map((line) => line.length));

  it('breaks the widest line down to something that can be read', () => {
    // The opening arrives as one line per story, and the longest is 88
    // characters. That single line was deciding the size of every glyph in the
    // card: autoFit shrinks until the widest line fits the square.
    expect(longest(OPENING_LINES)).toBeGreaterThan(80);
    expect(longest(wrapCard(OPENING_LINES))).toBeLessThan(35);
  });

  it('gives a long card more lines and a short one fewer', () => {
    const opening = wrapCard(OPENING_LINES).split('\n');
    const signoff = wrapCard('The last jet fades into distance. For a moment, even the dark is finished.')
      .split('\n');

    // The target width scales with the character count, so a short card is
    // wrapped narrower and comes up larger rather than sitting tiny in the
    // middle of a square sized for the long one.
    expect(opening.length).toBeGreaterThan(7);
    expect(signoff.length).toBeLessThan(opening.length);
  });

  it('never breaks a word', () => {
    const words = (text) => text.split(/\s+/).filter(Boolean);
    expect(words(wrapCard(OPENING_LINES))).toEqual(words(OPENING_LINES));
  });

  it('is idempotent, so re-wrapping a card does not walk it narrower', () => {
    const once = wrapCard(OPENING_LINES);
    expect(wrapCard(once)).toBe(once);
  });

  it('leaves no single word alone on the last line', () => {
    // A widow reads as a mistake rather than as a line.
    for (const text of [OPENING_LINES, 'One two three four five six seven eight nine ten eleven']) {
      const lines = wrapCard(text).split('\n');
      if (lines.length > 1) expect(lines[lines.length - 1]).toContain(' ');
    }
  });

  it('has nothing to wrap for nothing', () => {
    expect(wrapCard('')).toBe('');
    expect(wrapCard('   \n  ')).toBe('');
  });
});

describe('the card patch, at a readable size', () => {
  it('asks for a texture bigger than the node would default to', () => {
    const patch = endCardPatch('Four things found out this week, and what it is to live with them.');
    // 1024 is the node's default and softens every glyph at 1080 output.
    expect(patch.nodes[0].params.resolution).toBe(RESOLUTION);
    expect(RESOLUTION).toBeGreaterThan(1024);
  });

  it('hands the node text already broken into lines', () => {
    const patch = endCardPatch(
      'Black holes disclose when feeding turns to jets, and darkness remembers its poor manners.'
    );
    expect(patch.nodes[0].params.text).toContain('\n');
  });

  it('trims before it wraps, so an over-long card loses a clause not a line', () => {
    const patch = endCardPatch('sediment '.repeat(200));
    const text = patch.nodes[0].params.text;

    expect(text).toContain('…');
    // The ellipsis ends the card rather than sitting mid-block.
    expect(text.trimEnd().endsWith('…')).toBe(true);
    expect(cardText('sediment '.repeat(200)).length).toBeLessThanOrEqual(MAX_CARD_CHARS);
  });
});

// -- a set nobody is playing into ------------------------------------------
//
// Pass 2 is written by a model, and a model is free to write an entry that
// waits for a cue or for the music. Both are legitimate — that is how a set
// written for a musician in the room reads — and both leave the performance on
// its first frame when nobody is playing into it. The scenario checker says so
// at the desk, which is how this was found; the artist should not then have to
// hand-edit a document the model has just written.

describe('ensureUnattended', () => {
  const modelSet = () => ({
    name: 'Messy Eaters',
    sections: [
      { id: 'intro', name: 'Opening', enter: 'manual', hold: { seconds: 26 }, next: 'cat' },
      // A bare string is what a model writes when it means "this section's own
      // cue" — and normalizeEnter reads any string that is not "manual" as a
      // cue to wait for.
      { id: 'cat', name: 'The Cat', enter: 'cat', hold: { seconds: 166 }, next: 'air' },
      { id: 'air', name: 'Air', enter: { when: 'level > 0.6' }, hold: { seconds: 166 } },
    ],
  });

  const stranded = (scenario) => validateScenario(normalizeScenario(scenario))
    .warnings.some((one) => /Nothing moves this set/.test(one.message));

  it('is the failure this exists to stop', () => {
    // Without it, the set holds one frame forever.
    expect(stranded(modelSet())).toBe(true);
  });

  it('gives a cue entry a deadline past the hold before it', () => {
    const set = ensureUnattended(modelSet());
    const cat = set.sections[1];

    expect(cat.enter.kind).toBe('cue');
    expect(cat.enter.cue).toBe('cat');
    // Strictly past the previous hold, or there is no window for the cue to
    // decide in and the checker says so.
    expect(cat.enter.by.seconds).toBeGreaterThan(26);
    expect(stranded(set)).toBe(false);
  });

  it('gives a condition entry one too', () => {
    const air = ensureUnattended(modelSet()).sections[2];
    expect(air.enter.kind).toBe('when');
    expect(air.enter.by.seconds).toBeGreaterThan(166);
  });

  it('leaves the cue itself deciding when it is fired', () => {
    // A deadline is a ceiling, not a replacement: the musician still moves the
    // set on whenever they like.
    const cat = ensureUnattended(modelSet()).sections[1];
    expect(cat.enter.cue).toBe('cat');
  });

  it('touches nothing that can already be entered on its own', () => {
    const set = {
      sections: [
        { id: 'a', name: 'A', enter: 'manual', hold: { seconds: 20 } },
        { id: 'b', name: 'B', enter: { seconds: 30 }, hold: { seconds: 20 } },
        { id: 'c', name: 'C', enter: 'manual', hold: { seconds: 20 } },
        { id: 'd', name: 'D', enter: { cue: 'drop', by: { bars: 8 } }, hold: { seconds: 20 } },
      ],
    };
    const after = ensureUnattended(set);
    const before = normalizeScenario(set);

    expect(after.sections.map((s) => s.enter)).toEqual(before.sections.map((s) => s.enter));
  });

  it('leaves a section alone when the one before it states no length', () => {
    // No floor to hang a ceiling off, and inventing a deadline the set does not
    // have is worse than the warning.
    const after = ensureUnattended({
      sections: [
        { id: 'a', name: 'A', enter: 'manual' },
        { id: 'b', name: 'B', enter: { cue: 'drop' } },
      ],
    });
    expect(after.sections[1].enter.by).toBeUndefined();
  });

  it('works in bars when that is the unit the set is written in', () => {
    const after = ensureUnattended({
      sections: [
        { id: 'a', name: 'A', enter: 'manual', hold: { bars: 32 } },
        { id: 'b', name: 'B', enter: { cue: 'drop' } },
      ],
    });
    expect(after.sections[1].enter.by.bars).toBeGreaterThan(32);
    expect(after.sections[1].enter.by.seconds).toBeNull();
  });
});
