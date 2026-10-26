// MIDI controllers: mapping knobs and faders to parameters. About four minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-midi.mjs --out scripts/tutorial-video/build/10midi
//
// Same format as scenes.mjs. It follows docs/midi.md where the editor does what
// it says, and the editor where it doesn't:
//   - The MIDI panel has Enable/Disable, Connected Devices, MIDI Learn, Active
//     Bindings (each with Remove), Clear All and MIDI Activity. The manual "Add
//     Binding", Edit, range, curve and invert settings the docs describe aren't
//     in it, so the video gives a mapping its range with an expression on `midi`
//     instead, as the docs' own expression section does.
//   - A parameter whose definition has no min/max (Voronoi Noise's Scale) maps
//     to 0-1, which is where that expression comes in.
//   - The Remove button on a binding does nothing in the editor (its inline
//     onclick is refused by the page's script-src 'self' policy), so the video
//     re-learns and uses Clear All, and leaves Remove out.
//   - The docs say MIDI Settings has no shortcut; it has Ctrl+Alt+M.
//
// There is no controller attached to the recording machine, so
// lib/virtual-midi.js answers requestMIDIAccess with one input port, drawn on
// screen as three knobs and a fader. The narration says so. Everything after
// the port, from Learn to the uniforms, is the editor's own MIDI path.

import { installVirtualMidi } from './lib/virtual-midi.js';

export const title = 'Rhizomium: MIDI controllers';
export const name = 'rhizomium-midi';

export const lexicon = {
  MIDI: 'middy',
  midi: 'middy',
  CC: 'C C',
  CCs: 'C Cs',
  USB: 'U S B',
  Ctrl: 'control',
  sin: 'sine',
};

// Graph (0, 0) sits just under the preview window, and the whole patch stays
// left of the MIDI panel.
const VIEW = { scale: 0.85, x: 60, y: 470 };
const BLANK = { x: 1000, y: 140 }; // empty canvas, right of the preview window
const COL = 210;

const RAMP = [
  { position: 0.0, color: [0.05, 0.02, 0.16, 1] },
  { position: 0.45, color: [0.13, 0.88, 0.94, 1] },
  { position: 1.0, color: [1.0, 0.25, 0.62, 1] },
];
const n = (id, kind, col, row, params = {}) => ({ id, kind, x: col * COL, y: row * 270, params });
const c = (a, ap, z, zp) => ({ from: { nodeId: a, pin: ap }, to: { nodeId: z, pin: zp } });

// The expressions video's patch, without its Wave.
const PATCH = {
  nodes: [
    n('7', 'UV', 0, 0.5),
    n('8', 'Circle', 1, 0, { radius: 0.3, smoothness: 0.04 }),
    n('9', 'Rotate2D', 1, 1, { rotation: 0 }),
    n('10', 'VoronoiNoise', 2, 1, { scale: 6 }),
    n('11', 'Multiply', 3, 0.5),
    n('13', 'ComputeGradient', 4, 0.5, { colorMode: 'Gradient', inputMix: 1, colorStops: RAMP }),
    n('14', 'OutputFinal', 5, 0.5),
  ],
  connections: [
    c('7', 0, '8', 0), c('7', 0, '9', 0), c('9', 0, '10', 0),
    c('8', 0, '11', 0), c('10', 0, '11', 1),
    c('11', 0, '13', 0), c('13', 0, '14', 0),
  ],
};

// Knob 1 starts where Radius 0.3 sits on its 0-2 range.
const CONTROLS = [
  { cc: 21, label: 'Knob 1', value: 19 },
  { cc: 22, label: 'Knob 2', value: 0 },
  { cc: 23, label: 'Knob 3', value: 0 },
  { cc: 7, label: 'Fader', type: 'fader', value: 0 },
];
// In the empty space right of the preview window.
const CONTROLLER_AT = { left: 760, bottom: 640 };

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
const PANEL = '#parameter-panel';
const MIDI = '#midi-settings-panel';
const CONTROLLER = '#virtual-midi';

/** Turn a control on the virtual controller from one value to another. */
const turn = (d, cc, from, to, ms = 1400) => d.safe(`turn CC ${cc}`, () => d.page.evaluate(
  ([cc, from, to, ms]) => { window.__midi.hot(cc); return window.__midi.sweep(cc, from, to, ms); },
  [cc, from, to, ms],
));

/** Turn a control back and forth from where it is now. */
async function play(d, cc, values, ms = 1100) {
  for (const v of values) {
    const from = await d.page.evaluate((cc) => window.__midi.value(cc), cc).catch(() => 0);
    await turn(d, cc, from, v, ms);
  }
}

const cool = (d) => d.page.evaluate(() => window.__midi?.hot(null)).catch(() => {});

/**
 * Open a node's parameters. A double-click that lands while the shader is
 * recompiling can arrive as a drag (moving the node) or as a double-click on
 * the title (renaming it), so the rename is cancelled, the node put back, and
 * the double-click tried again until the panel shows it.
 */
async function openNode(d, nid) {
  if (!nid) return;
  const home = (await d.nodes()).find((n) => n.id === nid);
  for (let attempt = 0; attempt < 3; attempt++) {
    await d.page.mouse.up().catch(() => {});
    await d.wait(0.4);
    await d.dblclick(await d.body(nid, 60), { settle: 700 });
    const state = await d.page.evaluate((nid) => ({
      open: window.editor.paramPanel?.selectedNode?.id === nid,
      renaming: document.activeElement?.tagName === 'INPUT' && !document.activeElement.closest('#parameter-panel'),
      node: window.editor.graph.nodes.find((n) => n.id === nid),
    }), nid);
    if (state.renaming) await d.key('Escape', 200);
    if (state.node && (state.node.x !== home.x || state.node.y !== home.y)) {
      await d.page.evaluate(([nid, x, y]) => {
        const n = window.editor.graph.nodes.find((n) => n.id === nid);
        n.x = x;
        n.y = y;
        window.editor.markDirty?.('tour-restore');
      }, [nid, home.x, home.y]);
    }
    if (state.open) return;
    d.warnings.push(`[${d.scene?.id}] open ${nid}: retry ${attempt + 1}`);
  }
}

/** Open a node's parameters, if another node's are showing. */
async function ensureOpen(d, kind) {
  const nid = await id(d, kind);
  const open = await d.page.evaluate((nid) => window.editor.paramPanel?.selectedNode?.id === nid, nid).catch(() => false);
  if (!open) await openNode(d, nid);
  return nid;
}

/** Click into a parameter's field, then Start MIDI Learn. */
async function startLearn(d, label) {
  await d.click(d.paramField(label), { settle: 300 });
  await d.click('#midi-learn-btn', { settle: 500 });
}

export default [
  {
    id: 'intro',
    title: 'MIDI controllers',
    chapter: false,
    say: `A MIDI controller puts your parameters under your fingers: turn a knob, and the picture answers straight away.
      In this video we'll connect a controller, map knobs and a fader with MIDI Learn, give a mapping the range you want with an expression, and look after your mappings.`,
    async run(d) {
      await d.card(`<h1>MIDI controllers</h1><p>Rhizomium <span class="accent">·</span> knobs and faders on your parameters</p>`);
      await d.safe('new graph', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
      });
      await d.safe('load patch', () => d.page.evaluate(async (patch) => {
        const { replaceGraphWithPatch } = await import('/src/ai/applyResult.js');
        await replaceGraphWithPatch(patch, { title: 'MIDI controllers', reason: 'tutorial' });
      }, PATCH));
      await d.safe('virtual controller', () => d.page.evaluate(installVirtualMidi, { controls: CONTROLS, at: CONTROLLER_AT }));
      await d.wait(0.6);
      await setView(d, VIEW);
      await d.at(1);
      await d.card(`<h1>MIDI controllers</h1><ol>
        <li>Connecting a controller</li><li>MIDI Learn</li>
        <li>Knobs and faders</li><li>Ranges with <code>midi</code></li><li>Managing mappings</li></ol>`);
      await d.wait(6.5);
      await d.card('');
    },
  },

  // docs/midi.md - Quick Start, Step 1 and 2; MIDI Settings Panel
  {
    id: 'connect',
    title: 'Connecting a controller',
    say: `Plug your controller in over USB, and open Tools, MIDI Settings, or press Ctrl Alt M.
      Click Enable MIDI. The status turns to Connected, and every controller the computer can see is listed under Connected Devices.
      There's no hardware attached to this machine, so for this video we're using an on-screen controller that sends the same messages a real one does: three knobs and a fader.
      Each knob or fader sends a control change, or CC, with a number that identifies it, and a value from 0 to 127.
      Turn a knob, and MIDI Activity shows what arrived: the device, the CC number, and the value.`,
    async run(d) {
      await d.at(0, 1.5);
      await d.menu('Tools', 'MIDI Settings', { hold: 600 });
      await d.at(1);
      await d.highlight('#midi-enable-btn', 'Enable MIDI');
      await d.wait(0.8);
      await d.click('#midi-enable-btn', { settle: 500 });
      await d.clearHighlights();
      await d.at(2);
      await d.highlight('#midi-status', 'Connected');
      await d.wait(1.6);
      await d.clearHighlights();
      await d.highlight('#midi-devices-list', 'Connected Devices');
      await d.at(3);
      await d.clearHighlights();
      await d.page.evaluate(() => window.__midi.show()).catch(() => {});
      await d.highlight(CONTROLLER, 'On-screen controller');
      await d.at(4);
      await d.clearHighlights();
      await d.at(5);
      await d.highlight('#midi-activity', 'MIDI Activity');
      await play(d, 21, [60, 19], 1300);
      await play(d, 7, [90, 0], 1300);
      await cool(d);
      await d.wait(1);
      await d.clearHighlights();
    },
  },

  // docs/midi.md - Step 3: Map a Parameter (MIDI Learn)
  {
    id: 'learn',
    title: 'MIDI Learn',
    say: `Mapping a control takes three steps.
      Double-click the Circle to open its parameters, and click into the Radius field.
      In the MIDI panel, click Start MIDI Learn. It shows which parameter it's waiting for.
      Now move the control you want. The first one that moves is mapped, here Knob 1.
      Radius gets a MIDI badge, and a line naming its CC.
      Turn the knob, and the circle grows and shrinks with it. The knob's 0 to 127 is spread across the parameter's range, here 0 to 2.
      The value goes straight to the GPU, so nothing is recompiled while you play.`,
    async run(d) {
      await d.at(1);
      await openNode(d, await id(d, 'Circle'));
      await d.click(d.paramField('Radius'), { settle: 300 });
      await d.highlight(d.paramBlock('Radius'), 'Radius');
      await d.at(2);
      await d.clearHighlights();
      await d.click('#midi-learn-btn', { settle: 500 });
      await d.at(3);
      await d.highlight('#midi-learn-status', 'Waiting for input');
      await d.at(4, 1);
      await d.clearHighlights();
      await turn(d, 21, 19, 30, 900);
      await d.wait(0.6);
      await d.highlight('#midi-bindings-list', 'CC 21 → Circle.radius');
      await d.at(6);
      await d.clearHighlights();
      await d.highlight(`${PANEL} .external-control-badge--midi`, 'MIDI');
      await d.at(7);
      await d.clearHighlights();
      await d.highlight(PREVIEW, 'Knob 1 → Radius');
      await play(d, 21, [70, 8, 45], 1500);
      await d.clearHighlights();
      await d.at(9);
      await play(d, 21, [20, 30], 1200);
      await cool(d);
    },
  },

  // docs/midi.md - Common Use Cases, Live Performance
  {
    id: 'more',
    title: 'Knobs and faders',
    say: `Map as many controls as you like, one parameter each.
      Open Rotate 2D, click Rotation, Start MIDI Learn, and turn Knob 2. Rotation's range is 0 to 360 degrees, so the knob turns the cells all the way round.
      A fader is learned just the same. Open the Voronoi Noise, click Scale, Start MIDI Learn, and push the fader.
      But this Scale has no range of its own, so the fader only covers 0 to 1, and at the top the cells are still one big blur.`,
    async run(d) {
      await d.at(1);
      await ensureOpen(d, 'Rotate2D');
      await startLearn(d, 'Rotation');
      await turn(d, 22, 0, 12, 700);
      await d.wait(0.5);
      await d.highlight(PREVIEW, 'Knob 2 → Rotation');
      await play(d, 22, [100, 40], 1600);
      await d.clearHighlights();
      await d.at(4);
      await ensureOpen(d, 'VoronoiNoise');
      await startLearn(d, 'Scale');
      await turn(d, 7, 0, 10, 600);
      await d.wait(0.5);
      await d.highlight('#midi-bindings-list', 'Three mappings');
      await d.at(5);
      await d.clearHighlights();
      await d.highlight(PREVIEW, 'Fader → Scale, 0 to 1');
      await play(d, 7, [127, 40, 127], 1300);
      await d.wait(1);
      await d.clearHighlights();
      await cool(d);
    },
  },

  // docs/midi.md - Using MIDI Inside an Expression
  {
    id: 'expression',
    title: 'Ranges with an expression',
    say: `The MIDI panel has no range setting, but an expression does the job.
      Type a formula into a mapped field, and the controller's value reaches it as midi, instead of overwriting what you typed.
      On Scale, type: equals 3, plus midi times 15.
      Now the fader sweeps from 3 cells to 18.
      The same trick adds movement. On Radius, type: equals midi, plus sin of time times 4, times 0.05.
      Knob 1 still sets the size, and the circle breathes around it.
      In each field, midi means the control mapped to that field, and nothing else.`,
    async run(d) {
      await ensureOpen(d, 'VoronoiNoise');
      await d.at(1);
      await d.highlight(d.paramBlock('Scale'), 'Mapped field');
      await d.at(2);
      await d.clearHighlights();
      await d.setParam('Scale', '=3 + midi * 15');
      await d.at(3);
      await d.highlight(PREVIEW, '3 to 18 cells');
      await play(d, 7, [0, 127, 50], 1500);
      await d.clearHighlights();
      await cool(d);
      await d.at(4);
      await ensureOpen(d, 'Circle');
      await d.at(5, 1);
      await d.setParam('Radius', '=midi + sin(time * 4) * 0.05');
      await d.at(6);
      await d.highlight(PREVIEW, 'Size from the knob, breathing from time');
      await play(d, 21, [55, 25, 35], 1400);
      await d.clearHighlights();
      await cool(d);
      await d.at(7);
      await d.highlight(d.paramBlock('Radius'), 'midi = Knob 1 here');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/midi.md - Managing Bindings, Saving MIDI Mappings
  {
    id: 'manage',
    title: 'Managing mappings',
    say: `Every mapping is listed under Active Bindings, with its CC, the node and parameter, and the range.
      To move a parameter to another control, learn it again. Open Rotate 2D, learn Rotation onto Knob 3, and Knob 2 lets go of it.
      Clear All removes every mapping, after asking first. We'll keep ours.
      Mappings are saved with the project, and come back when you open it again, so your controller is ready to play.`,
    async run(d) {
      await d.highlight('#midi-bindings-list', 'Active Bindings');
      await d.at(1);
      await d.clearHighlights();
      // Started a sentence early: pointer moves run slowly while the patch renders.
      await ensureOpen(d, 'Rotate2D');
      await d.click(d.paramField('Rotation'), { settle: 300 });
      await d.at(2);
      await d.click('#midi-learn-btn', { settle: 400 });
      await turn(d, 23, 0, 15, 700);
      await d.wait(0.4);
      await d.highlight('#midi-bindings-list', 'CC 23 → Rotation');
      await play(d, 23, [70], 1200);
      await cool(d);
      await d.at(3);
      await d.clearHighlights();
      await d.click('#midi-clear-all-btn', { settle: 500 });
      await d.at(4, 0.3);
      await d.safe('cancel', () => d.click(d.page.locator('.modal-button', { hasText: 'Cancel' }).first(), { settle: 300 }));
      await d.at(5);
      await d.card(`<h1>Saved with the project</h1><ul>
        <li>Every mapping: CC, node, parameter and range</li>
        <li>Expressions on <code>midi</code> stay in their fields</li></ul>`);
      await d.at(5, 6);
      await d.card('');
    },
  },

  {
    id: 'outro',
    title: 'Next steps',
    say: `That's MIDI controllers: enable MIDI, learn a control, and shape it with an expression.
      Map a few knobs to the parameters you reach for most, and play your patch like an instrument.`,
    async run(d) {
      await d.page.evaluate(() => window.__midi?.show(false)).catch(() => {});
      await d.at(0, 2);
      await d.card(`<h1>MIDI controllers</h1><p>Enable <span class="accent">·</span> learn <span class="accent">·</span> shape with <code>midi</code></p>`);
    },
  },
];
