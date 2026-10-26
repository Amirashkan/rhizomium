// Audio reactivity: mic input, the bass/mid/high envelopes, and driving a
// parameter from the sound. About five minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-audio.mjs --out scripts/tutorial-video/build/06audio --audio-file scripts/tutorial-video/build/06audio/media/reel-bright18.wav
//
// Same format as scenes.mjs. It follows docs/audio-web.md, checked against the
// editor as it is (docs/audio-envelope.md now only covers the standalone Python
// server, which the editor no longer talks to, so the video leaves it out):
//   - The mic is Chrome's fake capture device playing --audio-file, so the
//     meters move to real music. The browser's permission prompt is granted
//     by make.mjs's --use-fake-ui-for-media-stream and never shows. Chrome
//     names that device "Fake Default Audio Input"; the scene relabels it
//     "Microphone", what the chip falls back to for an unnamed input.
//   - The mic is fed the showreel track with the top end lifted 15 dB above
//     2.5 kHz, peaking at -18 dBFS (build/06audio/media/reel-bright18.wav,
//     made from reel-m0.wav with ffmpeg
//     `highshelf=f=2500:g=15,volume=-15dB,alimiter=limit=0.125:level=0`).
//     The panel's meters and the envelope variables are scaled differently:
//     at full scale the envelopes sit near 1 and the circle barely moves,
//     while at a plain -18 dBFS the panel's High meter never leaves 0. A
//     bright, moderate feed, like a room mic, keeps both moving. (At these
//     levels `audioEnvelope` itself often reads 0 while the band variables
//     move, so the video drives everything from the bands.)
//   - Rotation is `time * 20 + audioEnvelopeHighs * 40`, not the docs'
//     `time * (30 + audioEnvelopeHighs * 300)`: scaling time's speed by a
//     moving number jumps the angle by time × the change, which grows the
//     longer the patch runs.
//
// The music isn't recorded with the screen. The mic scene writes when listening
// started to listen.json in --out, so the music can be mixed back under the
// narration afterwards (see the bottom of this file).

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const title = 'Rhizomium: audio reactivity';
export const name = 'rhizomium-audio';

export const lexicon = {
  audioEnvelope: 'audio envelope',
  audioEnvelopeBass: 'audio envelope bass',
  audioEnvelopeMids: 'audio envelope mids',
  audioEnvelopeHighs: 'audio envelope highs',
  lerp: 'lerp',
  Hz: 'hertz',
  kHz: 'kilohertz',
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const argOut = process.argv.indexOf('--out');
const OUT = resolve(argOut > 0 ? process.argv[argOut + 1] : join(HERE, 'build/06audio'));

// Graph (0, 0) sits just under the preview window.
const VIEW = { scale: 1, x: 140, y: 460 };
const BLANK = { x: 1500, y: 280 }; // empty canvas, right of the preview window
const COL = 270;

const RAMP = [
  { position: 0.0, color: [0.05, 0.02, 0.16, 1] },
  { position: 0.45, color: [0.13, 0.88, 0.94, 1] },
  { position: 1.0, color: [1.0, 0.25, 0.62, 1] },
];
const n = (id, kind, col, row, params = {}) => ({ id, kind, x: col * COL, y: row * 270, params });
const c = (a, ap, z, zp) => ({ from: { nodeId: a, pin: ap }, to: { nodeId: z, pin: zp } });

// Voronoi cells, turning slowly, seen through a circle.
const PATCH = {
  nodes: [
    n('uv', 'UV', 0, 0.5),
    n('circle', 'Circle', 1, 0, { radius: 0.3, smoothness: 0.04 }),
    n('rotate', 'Rotate2D', 1, 1, { rotation: 0 }),
    n('voronoi', 'VoronoiNoise', 2, 1, { scale: 6 }),
    n('multiply', 'Multiply', 3, 0.5),
    n('grad', 'ComputeGradient', 4, 0.5, { colorMode: 'Gradient', inputMix: 1, colorStops: RAMP }),
    n('out', 'OutputFinal', 5, 0.5),
  ],
  connections: [
    c('uv', 0, 'circle', 0), c('uv', 0, 'rotate', 0), c('rotate', 0, 'voronoi', 0),
    c('circle', 0, 'multiply', 0), c('voronoi', 0, 'multiply', 1),
    c('multiply', 0, 'grad', 0), c('grad', 0, 'out', 0),
  ],
};

/** Set the viewport outright. */
const setView = (d, { scale, x, y }) => d.page.evaluate(([s, x, y]) => {
  const v = window.editor.viewport;
  v.scale = s;
  v.offsetX = x;
  v.offsetY = y;
  window.editor.markDirty?.('tour-view');
}, [scale, x, y]).catch(() => {});

const id = async (d, kind) => (await d.node(kind))?.id;

const PREVIEW = '.floating-gpu-preview .preview-canvas-wrapper';

const panel = (d) => d.page.locator('#audio-settings-panel');
const row = (d, channel) => panel(d).locator(`.rzap-row[data-channel="${channel}"]`);

/** Open the Audio panel if it isn't showing. */
async function openAudio(d) {
  if (await panel(d).isVisible().catch(() => false)) return;
  await d.menu('Tools', 'Audio');
  await d.wait(0.6);
}

async function closeAudio(d) {
  await d.closeWindow('#audio-settings-panel');
}

/** Open a node's parameters, type an expression into one, and close the panel again. */
async function drive(d, kind, label, expr) {
  const nid = await id(d, kind);
  if (!nid) return;
  await d.openParams(nid);
  await d.highlight(d.paramBlock(label), label);
  await d.setParam(label, expr);
  await d.clearHighlights();
}

/** Note when the mic opened, for mixing the music back in later. */
const markListen = (d) => writeFileSync(join(OUT, 'listen.json'), JSON.stringify({ listen: d.clock() }));

export default [
  {
    id: 'intro',
    title: 'Audio reactivity',
    chapter: false,
    say: `Rhizomium can listen. Point a microphone at a speaker, or plug in a line-in, and your visuals move with the music.
      In this video we'll turn on the mic, read the bass, mid and high envelopes, and use them to drive parameters.`,
    async run(d) {
      await d.card(`<h1>Audio reactivity</h1><p>Rhizomium <span class="accent">·</span> make your visuals listen</p>`);
      await d.safe('new graph', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
      });
      await d.safe('load patch', () => d.page.evaluate(async (patch) => {
        const { replaceGraphWithPatch } = await import('/src/ai/applyResult.js');
        await replaceGraphWithPatch(patch, { title: 'Audio reactivity', reason: 'tutorial' });
      }, PATCH));
      await d.wait(0.6);
      await setView(d, VIEW);
      await d.at(2);
      await d.card(`<h1>Audio reactivity</h1><ol><li>Turn on the mic</li><li>Read the bass, mid and high envelopes</li><li>Drive a parameter from the sound</li></ol>`);
      await d.wait(4);
      await d.card('');
    },
  },

  // A tour of the patch, so the viewer knows which parameter will do what.
  {
    id: 'patch',
    title: 'The patch',
    say: `Here's a small patch to work with.
      A Circle masks a field of Voronoi cells, and a Gradient colours the result.
      The cells go through a Rotate 2D node first, so we can turn them.
      Right now nothing moves. Let's give it something to listen to.`,
    async run(d) {
      await d.at(1);
      for (const [kind, label] of [['Circle', 'Circle'], ['VoronoiNoise', 'Voronoi cells'], ['ComputeGradient', 'Gradient']]) {
        const nid = await id(d, kind);
        if (nid) await d.highlight(await d.nodeRect(nid, 200), label);
        await d.wait(1.1);
        await d.clearHighlights();
      }
      await d.at(2);
      const rot = await id(d, 'Rotate2D');
      if (rot) await d.highlight(await d.nodeRect(rot, 200), 'Rotate 2D');
      await d.at(3);
      await d.clearHighlights();
    },
  },

  // docs/audio-web.md - Step 1, Audio Sources
  {
    id: 'panel',
    title: 'The Audio panel',
    say: `All the listening happens in the Audio panel. Open Tools, Audio, or press Control Alt A.
      At the top are three sources. File plays a track from disk, Mic and line-in takes a live input, and System captures sound that another app is already playing.
      Only one runs at a time: starting a live input pauses the file.
      The chip next to the title says what the analysis is hearing. Right now, nothing.`,
    async run(d) {
      await d.at(1);
      await openAudio(d);
      await d.at(2);
      await d.highlight(panel(d).locator('.rzap-tabs'), 'Sources');
      await d.at(4, 0.4);
      await d.clearHighlights();
      await d.at(5);
      await d.highlight(panel(d).locator('#audio-state'), 'Status');
      await d.wait(2.5);
      await d.clearHighlights();
    },
  },

  // docs/audio-web.md - Mic / line-in
  {
    id: 'mic',
    title: 'Turning on the mic',
    say: `Click the Mic and line-in tab, then press Listen.
      The first time, the browser asks for permission to use the microphone. Allow it.
      The chip now names the input it's hearing, and the meters start moving.
      If you have more than one input, an audio interface say, pick it from the device menu.
      Echo cancellation, noise suppression and auto-gain are all switched off. They're built for phone calls, and auto-gain would flatten the very loud-and-quiet difference you want to see.
      Nothing is played back to your speakers, so there's no feedback loop.`,
    async run(d) {
      await d.click(panel(d).locator('.rzap-tab[data-source="mic"]'), { settle: 600 });
      await d.wait(0.5);
      await d.highlight(panel(d).locator('#audio-live-toggle'), 'Listen');
      await d.wait(0.8);
      await d.clearHighlights();
      await d.page.evaluate(() => Object.defineProperty(MediaStreamTrack.prototype, 'label', { get: () => 'Microphone' })).catch(() => {});
      await d.click(panel(d).locator('#audio-live-toggle'), { settle: 800 });
      markListen(d);
      await d.at(3);
      await d.highlight(panel(d).locator('#audio-state'), 'Listening');
      await d.wait(2);
      await d.clearHighlights();
      await d.at(4);
      await d.highlight(panel(d).locator('#audio-device-row'), 'Input device');
      await d.at(5);
      await d.clearHighlights();
      await d.at(7);
      await d.highlight(panel(d).locator('#audio-live-note'), 'Nothing played back');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/audio-web.md - Channels
  {
    id: 'meters',
    title: 'Bass, mids and highs',
    say: `Down the panel is a live meter for every channel the analysis produces.
      The first group is the signal itself. Level is the overall loudness.
      Low is the bass band, from twenty to two hundred and fifty Hz: kick drums and bass lines.
      Mid runs from two hundred and fifty Hz to two kHz, where vocals, guitars and most synths sit.
      High is everything above two kHz: hi-hats, cymbals and the air on top.
      Further down are Kick, Snare and Hat detectors with triggers, for hitting on the beat. They're a topic of their own, so today we'll stay with the three bands.`,
    async run(d) {
      await d.safe('scroll to channels', () => panel(d).locator('#audio-channels').scrollIntoViewIfNeeded());
      await d.wait(0.4);
      await d.highlight(panel(d).locator('#audio-channels'), 'Channels');
      await d.at(1);
      await d.clearHighlights();
      await d.highlight(panel(d).locator('#audio-channels .rzap-group').first(), 'Signal');
      await d.at(2);
      await d.clearHighlights();
      await d.highlight(row(d, 'level'), 'Level');
      for (const [i, ch, label] of [[3, 'low', 'Low · 20–250 Hz'], [4, 'mid', 'Mid · 250 Hz–2 kHz'], [5, 'high', 'High · 2 kHz +']]) {
        await d.at(i);
        await d.clearHighlights();
        await d.highlight(row(d, ch), label);
      }
      await d.at(6);
      await d.clearHighlights();
      const drums = panel(d).locator('#audio-channels .rzap-group').nth(1);
      await d.safe('scroll to drums', () => drums.scrollIntoViewIfNeeded());
      await d.highlight(drums, 'Drum detectors');
      await d.wait(3);
      await d.clearHighlights();
      await d.safe('scroll back', () => panel(d).locator('#audio-channels').scrollIntoViewIfNeeded());
    },
  },

  // docs/audio-web.md - Step 2, Step 3
  {
    id: 'envelopes',
    title: 'The envelope variables',
    say: `Those bands reach your patch through parameter expressions. Type an equals sign into any number field, and what follows is a formula, worked out every frame.
      Four audio variables are available. audioEnvelope is the overall level.
      audioEnvelopeBass, audioEnvelopeMids and audioEnvelopeHighs follow the same three bands as the meters.
      Each one is an envelope: it rises quickly when the sound gets louder and falls back more slowly, so it follows the shape of the music rather than every wiggle of the waveform.
      And all of them run from zero, silence, to one, as loud as it gets.`,
    async run(d) {
      await closeAudio(d);
      await d.at(1);
      await d.card(`<h1>Type <code>=</code> to start an expression</h1><p>Any number field becomes a formula, worked out every frame</p>`);
      await d.at(2);
      await d.card(`<h1>Envelope variables</h1><ul>
        <li><code>audioEnvelope</code> overall level</li>
        <li><code>audioEnvelopeBass</code> 20–250 Hz</li>
        <li><code>audioEnvelopeMids</code> 250 Hz–2 kHz</li>
        <li><code>audioEnvelopeHighs</code> 2 kHz and up</li></ul>
        <p>Every one runs from <span class="accent">0</span> to <span class="accent">1</span></p>`);
      await d.at(4, 4);
      await d.card('');
    },
  },

  // docs/audio-web.md - Pulsing Circle, Tips 1 and 2
  {
    id: 'bass',
    title: 'Bass drives the size',
    say: `Let's start with the bass, because it carries the beat.
      Double-click the Circle to open its parameters, and click into Radius.
      Type equals, 0.2, plus audioEnvelopeBass, times 0.3, and press Enter.
      Now the circle kicks with the drums.
      The two numbers are the whole trick. 0.2 is the size it rests at in silence. 0.3 is how far the bass can push it, so at full bass the radius reaches 0.5.
      Make the second number bigger for a stronger hit, and the first one bigger if the circle disappears in quiet passages.`,
    async run(d) {
      await d.at(1);
      const circle = await id(d, 'Circle');
      await d.openParams(circle);
      await d.highlight(d.paramBlock('Radius'), 'Radius');
      await d.at(2);
      await d.clearHighlights();
      await d.setParam('Radius', '=0.2 + audioEnvelopeBass * 0.3');
      await d.at(3);
      await d.highlight(PREVIEW, 'Preview');
      await d.wait(3);
      await d.clearHighlights();
      await d.at(5);
      await d.highlight(d.paramBlock('Radius'), '0.2 at rest · up to 0.5');
      await d.at(7, 2);
      await d.clearHighlights();
    },
  },

  // docs/audio-web.md - Color Changes / Reactive Complexity, applied to the cells
  {
    id: 'mids',
    title: 'Mids drive the cells',
    say: `The mids move differently. They follow the melody and the voice, rather than the beat.
      Open the Voronoi node, and set its Scale to 2, plus audioEnvelopeMids, times 10.
      When the music gets busier in the middle, the cells get smaller and more crowded.
      Because each band follows its own instruments, mapping them to different parameters makes different parts of the picture answer to different parts of the song.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await d.at(2);
      await drive(d, 'VoronoiNoise', 'Scale', '=2 + audioEnvelopeMids * 10');
      await d.at(3);
      await d.highlight(PREVIEW, 'Preview');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/audio-web.md - Rotation Speed, Tip 4
  {
    id: 'highs',
    title: 'Highs drive the rotation',
    say: `Last, the highs. The hi-hats are quick and bright, so they suit a quick, small movement.
      Open Rotate 2D, and set Rotation to time times 20, plus audioEnvelopeHighs times 40.
      Time keeps the cells turning slowly, twenty degrees a second, and the hats add a nudge of up to forty degrees on top.
      Add the audio to time, rather than multiplying time by it. Time keeps growing, so multiplying it by a moving number makes the angle jump further the longer the patch runs.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await d.at(2);
      await drive(d, 'Rotate2D', 'Rotation', '=time * 20 + audioEnvelopeHighs * 40');
      await d.at(3);
      await d.highlight(PREVIEW, 'Preview');
      await d.wait(3);
      await d.clearHighlights();
      await d.at(4);
      await d.card(`<h1>Add, don't multiply</h1><p><code>=time * 20 + audioEnvelopeHighs * 40</code></p>
        <p><small>not</small> <code>=time * (20 + audioEnvelopeHighs * 40)</code></p>`);
      await d.at(5, 5);
      await d.card('');
      await d.click(BLANK, { settle: 300 });
    },
  },

  // docs/audio-web.md - Tips, Troubleshooting
  {
    id: 'tuning',
    title: 'Tuning the response',
    say: `A few patterns help once the basics work.
      lerp maps an envelope into an exact range: lerp of 0.2, 0.8 and the envelope goes from 0.2 in silence to 0.8 at full.
      clamp keeps a value inside a limit, so a loud passage can't push it too far.
      And if the visuals barely react, multiply the envelope by more. If they're too twitchy, multiply by less.
      If every meter sits at zero, check that Listen is on, and that Windows allows the browser to use the microphone, under Privacy and security.`,
    async run(d) {
      await d.at(0, 2);
      await d.card(`<h1>Tuning the response</h1><ul>
        <li><code>=lerp(0.2, 0.8, audioEnvelopeMids)</code> into an exact range</li>
        <li><code>=clamp(audioEnvelopeBass * 2, 0, 1)</code> with a ceiling</li>
        <li><code>× more</code> if it barely moves, <code>× less</code> if it twitches</li></ul>`);
      await d.at(3);
      await d.card('');
      await openAudio(d);
      await d.highlight(panel(d).locator('#audio-state'), 'Listening?');
      await d.wait(3);
      await d.clearHighlights();
      await closeAudio(d);
    },
  },

  {
    id: 'outro',
    title: 'Next steps',
    say: `That's audio reactivity: a live input, three band envelopes, and an expression on any parameter.
      Try it with your own music, and see which parts of the picture each band should own.`,
    async run(d) {
      await d.at(1);
      await d.card(`<h1>Ctrl + Alt + A</h1><p>Mic <span class="accent">·</span> bass, mids, highs <span class="accent">·</span> <code>=audioEnvelopeBass</code></p>`);
    },
  },
];

// Mixing the music back in. listen.json holds the recording time (s) at which
// the mic opened. Chrome's fake device starts --audio-file from its beginning
// when the capture opens, and loops it. Mix the untouched track, not the
// bright, quiet copy the mic was fed:
//
//   ffmpeg -i build/06audio/rhizomium-audio.mp4 -stream_loop -1 -i build/06audio/media/reel-m0.wav \
//     -filter_complex "[0:a]pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[v];[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,afade=t=in:d=1.5,adelay=<listen ms>|<listen ms>,volume=0.22[m];[v][m]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3,atrim=0:<length>,afade=t=out:st=<length - 4>:d=4[a]" \
//     -map 0:v -map "[a]" -map "0:s?" -c:v copy -c:a aac -b:a 192k -ar 48000 -c:s copy -map_chapters 0 -t <length> \
//     build/06audio/rhizomium-audio-with-music.mp4
//
// (Not amix: on ffmpeg 4.2 it dropped the last ~4.5 s of the voice. amerge +
// pan sums the two tracks at full level; the voice is mono, so it is copied
// into both channels first.)
