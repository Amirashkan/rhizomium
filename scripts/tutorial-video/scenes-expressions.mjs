// Parameter expressions: the equals sign, time and functions, comparisons on
// the audio envelopes, and reading another node with `=node_12`. About five
// minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-expressions.mjs --out scripts/tutorial-video/build/07expressions --audio-file scripts/tutorial-video/build/06audio/media/reel-bright18.wav
//
// Same format as scenes.mjs. It follows docs/parameter-expressions.md, checked
// against the editor as it is. Each expression shown was tried in the live
// editor first, with the circle measured in the preview:
//   - `=audioEnvelopeBass > 0.6` gives 0 or 1, and `? :` picks between two
//     values. Multiplying a comparison, `(audioEnvelopeBass > 0.6) * 0.2`,
//     fails the shader (WGSL has no bool * float) and blanks the whole render,
//     so the video only uses `? :`.
//   - `frame` and `mouse.x`, which the docs list, fall back to the parameter's
//     default in a shader parameter, so the video leaves them out.
//   - An unknown name (`tim`) drops that one parameter to its default (the
//     Circle's 0.25); the rest of the render carries on.
//   - The panel's "→" readout shows 0 for anything reading the audio
//     envelopes, so the audio scene points at the preview, not the readout.
//
// The mic is Chrome's fake capture device playing --audio-file, as in
// scenes-audio.mjs, so the bass crosses 0.6 on the kicks. The mic scene writes
// listen.json to --out for mixing the music back in (see the bottom of
// scenes-audio.mjs for the ffmpeg line).

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const title = 'Rhizomium: parameter expressions';
export const name = 'rhizomium-expressions';

export const lexicon = {
  audioEnvelope: 'audio envelope',
  audioEnvelopeBass: 'audio envelope bass',
  audioEnvelopeMids: 'audio envelope mids',
  audioEnvelopeHighs: 'audio envelope highs',
  lerp: 'lerp',
  fract: 'fract',
  smoothstep: 'smooth step',
  LFO: 'L F O',
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const argOut = process.argv.indexOf('--out');
const OUT = resolve(argOut > 0 ? process.argv[argOut + 1] : join(HERE, 'build/07expressions'));

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

// The audio video's patch, with numeric ids so the headers read like a real
// graph's, and a Wave of its own as #12 for `=node_12`.
const WAVE = '12';
const PATCH = {
  nodes: [
    n('7', 'UV', 0, 0.5),
    n('8', 'Circle', 1, 0, { radius: 0.3, smoothness: 0.04 }),
    n('9', 'Rotate2D', 1, 1, { rotation: 0 }),
    n('10', 'VoronoiNoise', 2, 1, { scale: 6 }),
    n('11', 'Multiply', 3, 0.5),
    n(WAVE, 'Wave', 2, -1, { frequency: 0.25, amplitude: 1, offset: 0, unipolar: true }),
    n('13', 'ComputeGradient', 4, 0.5, { colorMode: 'Gradient', inputMix: 1, colorStops: RAMP }),
    n('14', 'OutputFinal', 5, 0.5),
  ],
  connections: [
    c('7', 0, '8', 0), c('7', 0, '9', 0), c('9', 0, '10', 0),
    c('8', 0, '11', 0), c('10', 0, '11', 1),
    c('11', 0, '13', 0), c('13', 0, '14', 0),
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
const readout = (d, label) => d.paramBlock(label).locator('.expression-result');

const audio = (d) => d.page.locator('#audio-settings-panel');

/** Note when the mic opened, for mixing the music back in later. */
const markListen = (d) => writeFileSync(join(OUT, 'listen.json'), JSON.stringify({ listen: d.clock() }));

/** Open the Circle's parameters, if they aren't showing already. */
async function openCircle(d) {
  const open = await d.paramBlock('Radius').isVisible().catch(() => false);
  if (!open) await d.openParams(await id(d, 'Circle'));
}

export default [
  {
    id: 'intro',
    title: 'Parameter expressions',
    chapter: false,
    say: `Every number in Rhizomium can be a formula. Type an equals sign into a parameter, and what follows is worked out again every frame.
      In this video we'll write a first expression, make it move with time, switch it with the music, and read the value of another node.`,
    async run(d) {
      await d.card(`<h1>Parameter expressions</h1><p>Rhizomium <span class="accent">·</span> a formula in any number field</p>`);
      await d.safe('new graph', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
      });
      await d.safe('load patch', () => d.page.evaluate(async (patch) => {
        const { replaceGraphWithPatch } = await import('/src/ai/applyResult.js');
        await replaceGraphWithPatch(patch, { title: 'Parameter expressions', reason: 'tutorial' });
      }, PATCH));
      await d.wait(0.6);
      await setView(d, VIEW);
      await d.at(2);
      await d.card(`<h1>Parameter expressions</h1><ol>
        <li>The equals sign</li><li>Time and functions</li>
        <li>Switching with <code>&gt;</code> and <code>? :</code></li><li>Reading a node with <code>node_12</code></li></ol>`);
      await d.wait(5);
      await d.card('');
    },
  },

  {
    id: 'patch',
    title: 'The patch',
    say: `Here's the patch from the audio video.
      A Circle masks a field of Voronoi cells, the cells turn through a Rotate 2D node, and a Gradient colours the result.
      There's one new node, sitting on its own: a Wave. It's a slow LFO, and we'll come back to it.
      Right now every parameter holds a plain number, so nothing moves.`,
    async run(d) {
      await d.at(1);
      for (const [kind, label] of [['Circle', 'Circle'], ['VoronoiNoise', 'Voronoi cells'], ['Rotate2D', 'Rotate 2D'], ['ComputeGradient', 'Gradient']]) {
        const nid = await id(d, kind);
        if (nid) await d.highlight(await d.nodeRect(nid, 200), label);
        await d.wait(0.9);
        await d.clearHighlights();
      }
      await d.at(2);
      await d.highlight(await d.nodeRect(WAVE, 200), 'Wave');
      await d.at(4);
      await d.clearHighlights();
    },
  },

  // docs/parameter-expressions.md - Quick Start
  {
    id: 'equals',
    title: 'The equals sign',
    say: `Double-click the Circle, and look at Radius. It holds 0.3.
      Click into it, type equals, 0.3, and press Enter. Nothing changes on screen, and that's the point: a number is already an expression.
      Under the field, the arrow shows what the expression works out to right now.
      Now let's make it move. Equals, 0.3, plus sin of time, times 0.1.
      time is the number of seconds since the patch started. sin turns it into a wave that swings between minus one and one.
      Times 0.1, plus 0.3, and the radius breathes between 0.2 and 0.4. Watch the readout follow it.`,
    async run(d) {
      await openCircle(d);
      await d.highlight(d.paramBlock('Radius'), 'Radius');
      await d.at(2);
      await d.clearHighlights();
      await d.setParam('Radius', '=0.3');
      await d.at(4);
      await d.highlight(readout(d, 'Radius'), 'Result');
      await d.wait(2.5);
      await d.clearHighlights();
      await d.at(6);
      await d.setParam('Radius', '=0.3 + sin(time) * 0.1');
      await d.highlight(PREVIEW, 'Preview');
      await d.at(7);
      await d.clearHighlights();
      await d.highlight(readout(d, 'Radius'), '0.2 to 0.4');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/parameter-expressions.md - Available Variables, Mathematical Functions
  {
    id: 'toolbox',
    title: 'Variables and functions',
    say: `Here's what you can write with.
      The usual arithmetic: plus, minus, times, divide, and brackets to group them.
      Functions such as sin and cos, abs, min and max, clamp, lerp, fract and smoothstep.
      And live variables: time, the four audio envelopes, and PI.
      One more: a parameter can name another parameter of the same node. On this Circle, equals smoothness times ten reads its own Smoothness field.`,
    async run(d) {
      await d.at(1);
      await d.card(`<h1>Arithmetic</h1><p><code>+</code> <code>-</code> <code>*</code> <code>/</code> <code>( )</code></p>
        <p><small><code>=(sin(time) + 1) * 0.5</code></small></p>`);
      await d.at(2);
      await d.card(`<h1>Functions</h1><p><code>sin</code> <code>cos</code> <code>abs</code> <code>min</code> <code>max</code></p>
        <p><code>clamp</code> <code>lerp</code> <code>fract</code> <code>smoothstep</code></p>`);
      await d.at(3);
      await d.card(`<h1>Variables</h1><ul>
        <li><code>time</code> seconds since the patch started</li>
        <li><code>audioEnvelope</code> <code>…Bass</code> <code>…Mids</code> <code>…Highs</code> from 0 to 1</li>
        <li><code>PI</code></li></ul>`);
      await d.at(4);
      await d.card(`<h1>Same-node parameters</h1><p><code>=smoothness * 10</code></p>
        <p><small>a parameter can read a sibling on its own node</small></p>`);
      await d.at(5, 5);
      await d.card('');
    },
  },

  // docs/parameter-expressions.md - Conditional Logic, Audio-Reactive / Threshold-based
  {
    id: 'compare',
    title: 'Switching on the bass',
    say: `Expressions can also ask a question. For that we need something to listen to, so open Tools, Audio, choose Mic and line-in, and press Listen. The audio video covers this panel in detail.
      Back on the Circle, set Radius to audioEnvelopeBass, greater than 0.6.
      A comparison gives one when it's true, and zero when it's false.
      So when the bass crosses 0.6, the radius jumps to one and fills the frame. The rest of the time it's zero, and the circle is gone.
      That's a switch, but a blunt one. To choose the two values yourself, add a question mark and a colon.
      audioEnvelopeBass greater than 0.6, question mark, 0.45, colon, 0.25.
      On a strong kick the circle snaps out to 0.45. Between kicks it rests at 0.25.
      Read it as: if the bass is above 0.6, then 0.45, otherwise 0.25. Less than works the same way.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await d.at(1, 2);
      await d.menu('Tools', 'Audio');
      await d.wait(0.5);
      await d.click(audio(d).locator('.rzap-tab[data-source="mic"]'), { settle: 500 });
      await d.page.evaluate(() => Object.defineProperty(MediaStreamTrack.prototype, 'label', { get: () => 'Microphone' })).catch(() => {});
      await d.click(audio(d).locator('#audio-live-toggle'), { settle: 800 });
      markListen(d);
      await d.highlight(audio(d).locator('#audio-state'), 'Listening');
      await d.wait(1.5);
      await d.clearHighlights();
      await d.closeWindow('#audio-settings-panel');
      await d.at(3);
      await openCircle(d);
      await d.setParam('Radius', '=audioEnvelopeBass > 0.6');
      await d.at(4);
      await d.card(`<h1><code>&gt;</code> gives <span class="accent">1</span> or <span class="accent">0</span></h1>
        <p>true is 1 <span class="accent">·</span> false is 0</p>`);
      await d.at(5);
      await d.card('');
      await d.highlight(PREVIEW, 'Bass above 0.6?');
      await d.at(7);
      await d.clearHighlights();
      await d.at(8, 4);
      await d.setParam('Radius', '=audioEnvelopeBass > 0.6 ? 0.45 : 0.25');
      await d.at(9);
      await d.highlight(PREVIEW, '0.45 on the kick · 0.25 between');
      await d.at(11);
      await d.clearHighlights();
      await d.card(`<h1>condition <code>?</code> then <code>:</code> otherwise</h1>
        <p><code>=audioEnvelopeBass &gt; 0.6 ? 0.45 : 0.25</code></p>`);
      await d.at(12, 3);
      await d.card('');
    },
  },

  // docs/parameter-expressions.md - Advanced Usage, Node References
  {
    id: 'node-ref',
    title: 'Reading another node',
    say: `Now, the Wave node. Look at its header: hash twelve. That's the node's ID, and every node has one.
      Typing equals node underscore twelve into a parameter reads that node's output. No wire needed.
      There's a quicker way than typing. Open Rotate 2D, then drag the Wave node and drop it on the Rotation field. The reference is written for you, and the Wave stays where it was.
      The Wave runs from zero to one, and Rotation is in degrees, so on its own that's a turn of one degree. Click at the end and add, times 90.
      Now the Wave swings the cells through ninety degrees and back, every four seconds.
      For a node with several outputs, like Audio Analysis, add another underscore and the output's number, counting from zero.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await d.at(1);
      const title = await d.title(WAVE);
      await d.highlight({ x: title.x - 40, y: title.y - 16, width: 180, height: 32 }, '#12');
      await d.at(3);
      await d.clearHighlights();
      await d.card(`<h1><code>=node_12</code></h1><p>reads node <span class="accent">#12</span>'s output</p>`);
      await d.at(5);
      await d.card('');
      await d.openParams(await id(d, 'Rotate2D'));
      await d.highlight(d.paramBlock('Rotation'), 'Rotation');
      await d.at(6, 2);
      await d.clearHighlights();
      await d.drag(await d.title(WAVE), d.paramField('Rotation'), { ms: 1400 });
      await d.wait(0.6);
      await d.highlight(d.paramBlock('Rotation'), '=node_12');
      await d.at(8);
      await d.clearHighlights();
      await d.at(9);
      await d.safe('append * 90', async () => {
        await d.click(d.paramField('Rotation'), { settle: 200 });
        await d.key('End', 100);
        await d.type(' * 90', { delay: 90 });
        await d.key('Enter', 500);
      });
      await d.at(10);
      await d.highlight(PREVIEW, 'Swinging with the Wave');
      await d.wait(3.5);
      await d.clearHighlights();
      await d.at(11);
      await d.card(`<h1>Several outputs</h1><p><code>=node_12_0</code> first <span class="accent">·</span> <code>=node_12_1</code> second</p>`);
      await d.at(11, 7);
      await d.card('');
    },
  },

  // docs/parameter-expressions.md - Troubleshooting
  {
    id: 'mistakes',
    title: 'When it doesn\'t work',
    say: `If an expression has a mistake in it, say time spelt without its e, the editor can't read it.
      Rather than breaking the whole picture, that one parameter falls back to its default value. Here the circle drops to a radius of 0.25, and everything else keeps running.
      So if a parameter suddenly stops responding, check the spelling. Names are case-sensitive: time, not Time with a capital T.
      Fix it, and it comes straight back.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await openCircle(d);
      await d.setParam('Radius', '=0.3 + sin(tim) * 0.1');
      await d.at(2);
      await d.highlight(PREVIEW, 'Back to the default');
      await d.at(3);
      await d.clearHighlights();
      await d.highlight(d.paramBlock('Radius'), 'tim?');
      await d.at(5);
      await d.clearHighlights();
      await d.setParam('Radius', '=0.3 + sin(time) * 0.1');
      await d.highlight(PREVIEW, 'Breathing again');
      await d.wait(2.5);
      await d.clearHighlights();
    },
  },

  {
    id: 'outro',
    title: 'Next steps',
    say: `That's parameter expressions: an equals sign, and a formula.
      time to animate, the audio envelopes to react, comparisons to switch, and node references to read a value without a wire.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await d.at(0, 3);
      await d.card(`<h1>Type <code>=</code></h1><ul>
        <li><code>=0.3 + sin(time) * 0.1</code></li>
        <li><code>=audioEnvelopeBass &gt; 0.6 ? 0.45 : 0.25</code></li>
        <li><code>=node_12 * 90</code></li></ul>`);
    },
  },
];
