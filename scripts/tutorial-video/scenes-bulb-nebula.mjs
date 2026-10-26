// Tutorial: building the Bulb Nebula patch from an empty graph, then making it
// dance to a song. Recorded with
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-bulb-nebula.mjs
//
// It needs three files beside each other (the repo root by default, or the
// folder in BULB_NEBULA_DIR):
//
//   bulb-nebula.rz           the patch as it was before it listened to anything.
//                            Its shader code is pasted in on camera.
//   bulb-nebula-reactive.rz  the finished patch, shown running in the intro.
//                            AUDIO_EDITS below turn the first into the second.
//   bulb-nebula.mp3          the song. The page plays it and the finished
//                            video carries it, ducked under the narration.
//
// Conventions are scenes.mjs's: `say` is the narration, `run` acts it out, and
// `await d.at(n)` waits for sentence n.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIR = resolve(process.env.BULB_NEBULA_DIR || join(HERE, '../..'));
const SOURCE = join(DIR, 'bulb-nebula.rz');
const FINISHED = join(DIR, 'bulb-nebula-reactive.rz');

export const name = 'bulb-nebula-tutorial';
export const title = 'Bulb Nebula: an audio-reactive patch in Rhizomium';
export const music = join(DIR, 'bulb-nebula.mp3');

export const lexicon = {
  FBM: 'F B M',
  vec3: 'vec three',
  vec4: 'vec four',
  WGSL: 'W G S L',
};

/**
 * What makes the patch listen, as edits to the code of four nodes: insert
 * `text` after `find`, or replace `find` with `text`. Typed on camera in the
 * last chapter, and applied by scripts that build the finished patch file.
 */
export const AUDIO_EDITS = {
  // Kick, on Input 3: the lens zooms in and the glow flares.
  Mandelbulb: [
    { find: 'let pw = input2;', text: '\nlet kick = input3;', after: true },
    { find: '1.7 * fw', text: '(1.7 + 0.4 * kick) * fw' },
    { find: 'exp(-de * 30.0) * 0.006', text: ' * (1.0 + 1.8 * kick)', after: true },
  ],
  // Kick, on a new Input 4: the filaments ignite and the clouds swell.
  Nebula: [
    { find: 'let rg = input2.x;', text: '\nlet kick = input4;', after: true },
    { find: '* neb * 2.2', text: '* neb * (1.6 + 3.0 * kick)' },
    { find: 'col = col *', text: ' (0.85 + 0.4 * kick) *', after: true },
  ],
  // Snare, on a new Input 4: an exposure flash on the backbeat.
  'Lens & Grade': [
    { find: 'let fr = input1;', text: '\nlet snare = input4;', after: true },
    { find: 'col * 0.9;', text: 'col * (0.9 + 0.5 * snare);' },
  ],
  // Snare on pin b: the fractal's power jumps, so its shape breathes.
  'Bulb Power': [{ find: '0.17)', text: ' + b * 0.6', after: true }],
  // Hat on pin b: the crystal sparks light up.
  'Crystal Sparks': [{ find: '* 0.9', text: '* (0.4 + 1.8 * b)' }],
};

/** Apply AUDIO_EDITS' list for one node to its code. */
export function applyEdits(code, edits) {
  return edits.reduce((c, e) => {
    const at = c.indexOf(e.find);
    if (at < 0) throw new Error(`"${e.find}" not found`);
    const end = at + e.find.length;
    return e.after ? c.slice(0, end) + e.text + c.slice(end) : c.slice(0, at) + e.text + c.slice(end);
  }, code);
}

// The analysis settings this song wants (the rest stay at their defaults): its
// kick is soft, and its hats sit low under the pads.
export const AUDIO_SETTINGS = { 'Kick Thresh': '0.35', 'Hat Thresh': '0.25' };

const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
const byLabel = (label) => source.nodes.find((n) => n.label === label);
const code = (label) => byLabel(label).params.code;
const expr = (label) => byLabel(label).params.expr;

// Where every node goes, in graph units: the source patch's own layout, plus a
// rack of audio nodes down the left.
const AT = {
  uv: [80, 370], time: [80, 950],
  twirl: [350, 80], spherize: [350, 370], polar: [350, 660], power: [350, 950],
  warp: [620, 80], fbm: [620, 370], ridged: [620, 660], voronoi: [620, 950],
  nebula: [890, 80], bulb: [890, 660], sparks: [890, 950],
  grade: [1160, 370], output: [1430, 370],
  audio: [-300, 470], kick: [-300, 620], snare: [-300, 720], hat: [-300, 820],
};
// The whole graph at 75 %, the rack at the left edge; the preview sits in the
// empty corner under Lens & Grade and the Output.
const VIEW = [0.75, -327, 20];
const PREVIEW = { left: 1110, top: 560, width: 790, height: 470 };

const N = {}; // node ids, filled in as the scenes create them
const BLANK = { x: 1300, y: 160 };

/** The id of the node carrying this name. */
function named(d, label) {
  return d.page.evaluate((l) => window.editor.graph.nodes.find((n) => n.name === l)?.id ?? null, label);
}

async function place(d, key, query, opts) {
  const [x, y] = AT[key];
  N[key] = await d.addNode(query, await d.world(x, y), opts);
  return N[key];
}

async function params(d, id, values) {
  await d.openParams(id);
  for (const [label, value] of Object.entries(values)) await d.setParam(label, value);
}

async function closeParams(d) {
  await d.click(BLANK, { settle: 300 });
}

async function setPreview(d, box) {
  await d.page.evaluate((b) => {
    const el = document.querySelector('.floating-gpu-preview');
    if (!el) return;
    Object.assign(el.style, { left: `${b.left}px`, top: `${b.top}px`, right: 'auto', bottom: 'auto', width: `${b.width}px`, height: `${b.height}px` });
    window.dispatchEvent(new Event('resize'));
  }, box);
}

async function fullscreen(d) {
  await d.click('.floating-gpu-preview .btn-fullscreen', { settle: 800 });
}

async function openAudio(d) {
  if (!(await d.page.locator('#audio-settings-panel').isVisible())) await d.menu('Tools', 'Audio');
}

export default [
  {
    id: 'intro',
    title: 'Bulb Nebula',
    chapter: false,
    say: `This is Bulb Nebula: a raymarched Mandelbulb, drifting through a deep-space nebula, and every part of it moves with the music.
      The kick drum pushes the lens in and sets the clouds alight, the snare flashes the exposure and makes the fractal breathe, and the hi-hats spark the crystals.
      In this tutorial we'll build it from an empty graph in Rhizomium.
      First the picture: two layers of warped noise, a fractal, and a final grade.
      Then we'll make it listen.
      The three long shaders are pasted in rather than typed, and you'll find them in the finished patch file.`,
    async run(d) {
      await d.card(`<h1>Bulb Nebula</h1><p>An audio-reactive patch in Rhizomium <span class="accent">·</span> built from scratch</p>`);
      // Behind the card: the finished patch, playing the song.
      await d.safe('set up', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
        await d.importPatch(JSON.parse(readFileSync(FINISHED, 'utf8')));
        await d.setView(...VIEW);
        await setPreview(d, PREVIEW);
        await openAudio(d);
        await d.page.locator('#audio-file-input').setInputFiles(music);
        await d.wait(0.8);
        await d.page.locator('#audio-playpause').click();
        await d.closeWindow('#audio-settings-panel');
      });
      await d.wait(1.5);
      await fullscreen(d);
      await d.card('');
      await d.at(2);
      await fullscreen(d);
      await d.at(3);
      for (const label of ['Nebula', 'Mandelbulb', 'Lens & Grade']) {
        const id = await named(d, label);
        if (id) await d.highlight(await d.nodeRect(id), label);
        await d.wait(1.1);
      }
      await d.at(4);
      await d.clearHighlights();
      const rack = await Promise.all(['Kick', 'Hat'].map(async (l) => d.nodeRect(await named(d, l))).map((p) => p.catch(() => null)));
      if (rack[0] && rack[1]) {
        await d.highlight({ x: rack[0].x, y: rack[0].y, width: rack[0].width, height: rack[1].y + rack[1].height - rack[0].y }, 'Audio');
      }
      await d.at(5);
      await d.clearHighlights();
    },
  },

  {
    id: 'canvas',
    title: 'Coordinates and time',
    say: `Start with an empty canvas: select everything with Control A, and delete it.
      Every pixel shader starts from coordinates, so right-click, search for U V, and place it.
      U V gives each pixel its position, from zero to one across the frame.
      Then add a Time node, the clock that will drive the camera and the fractal's slow change of shape.`,
    async run(d) {
      await d.page.evaluate(async () => {
        const { getBrowserAudioCapture } = await import('/src/audio/BrowserAudioCapture.js');
        getBrowserAudioCapture()?.stop?.();
      }).catch(() => {});
      await d.click(BLANK, { settle: 300 });
      await d.key('ControlOrMeta+A', 600);
      await d.key('Delete', 900);
      await d.at(1);
      await place(d, 'uv', 'uv');
      await d.at(3);
      await place(d, 'time', 'time');
    },
  },

  {
    id: 'warps',
    title: 'Bending space',
    say: `Before any noise is drawn, we bend the coordinates three ways.
      A Twirl node spins them around the centre: wire U V into it, and set the radius to 0.85 and the strength to 3.2, for a tight galactic swirl.
      A Spherize node bulges them outwards like a lens: radius 0.75, strength 0.9.
      And Polar Coordinates unrolls them into angle and distance, with an angular scale of 3 and a radial scale of 2.
      Each of these feeds a different noise in the next step, which is what keeps the layers from looking alike.`,
    async run(d) {
      await d.at(1);
      await place(d, 'twirl', 'twirl');
      await d.wire(N.uv, 0, N.twirl, 0);
      await params(d, N.twirl, { Radius: '0.85', Strength: '3.2' });
      await closeParams(d);
      await d.at(2);
      await place(d, 'spherize', 'spherize');
      await d.wire(N.uv, 0, N.spherize, 0);
      await params(d, N.spherize, { Radius: '0.75', Strength: '0.9' });
      await closeParams(d);
      await d.at(3);
      await place(d, 'polar', 'polar coordinates');
      await d.wire(N.uv, 0, N.polar, 0);
      await params(d, N.polar, { 'Angular Scale': '3', 'Radial Scale': '2' });
      await closeParams(d);
    },
  },

  {
    id: 'noise',
    title: 'Four kinds of noise',
    say: `Now the raw material.
      Warp Noise, fed by the Twirl, makes the main body of the clouds: five octaves, a scale of 2.2, a warp scale of 3, and a warp strength of 0.65.
      F B M noise, fed by the Spherize, adds fine dust: seven octaves, persistence 0.55, scale 5, and warp 0.9.
      Ridged Noise, also from the Twirl, makes the bright filaments: gain 0.55 and scale 3.5.
      And Voronoi noise on the polar coordinates, at a scale of 14, makes a ring of cells we'll turn into crystal sparks.`,
    async run(d) {
      await d.at(1);
      await place(d, 'warp', 'warp noise');
      await d.wire(N.twirl, 0, N.warp, 0);
      await params(d, N.warp, { Octaves: '5', Scale: '2.2', 'Warp Scale': '3', 'Warp Strength': '0.65' });
      await closeParams(d);
      await d.at(2);
      await place(d, 'fbm', 'fbm noise');
      await d.wire(N.spherize, 0, N.fbm, 0);
      await params(d, N.fbm, { Octaves: '7', Persistence: '0.55', Scale: '5', Warp: '0.9' });
      await closeParams(d);
      await d.at(3);
      await place(d, 'ridged', 'ridged noise');
      await d.wire(N.twirl, 0, N.ridged, 0);
      await params(d, N.ridged, { Gain: '0.55', Scale: '3.5' });
      await closeParams(d);
      await d.at(4);
      await place(d, 'voronoi', 'voronoi noise');
      await d.wire(N.polar, 0, N.voronoi, 0);
      await params(d, N.voronoi, { Scale: '14' });
      await closeParams(d);
    },
  },

  {
    id: 'nebula',
    title: 'The nebula shader',
    say: `The three cloud layers meet in a Custom GLSL node, which runs your own WGSL code.
      Double-click its title and name it Nebula.
      Wire Warp Noise into input 0, F B M into input 1, Ridged into input 2, and U V into input 3, for the starfield.
      Paste in the code.
      It mixes a deep violet and a teal from the noise, lights the filaments in orange where the clouds are thickest, and scatters twinkling stars.
      The last line is the result, a colour, so set Output Type to vec3.
      Add an Output node and wire the Nebula into it, and the preview shows the clouds.`,
    async run(d) {
      await place(d, 'nebula', 'custom glsl');
      await d.at(1);
      await d.rename(N.nebula, 'Nebula');
      await d.at(2);
      await d.wire(N.warp, 0, N.nebula, 0);
      await d.wire(N.fbm, 0, N.nebula, 1);
      await d.wire(N.ridged, 0, N.nebula, 2);
      await d.wire(N.uv, 0, N.nebula, 3);
      await d.at(3);
      await d.openParams(N.nebula);
      await d.pasteParam('Code', code('Nebula'));
      await d.at(5);
      await d.selectParam('Output Type', 'vec3');
      await closeParams(d);
      await d.at(6);
      await place(d, 'output', 'output');
      await d.wire(N.nebula, 0, N.output, 0);
      await d.wait(1);
      await d.highlight('.floating-gpu-preview', 'Preview');
      await d.wait(2.5);
      await d.clearHighlights();
    },
  },

  {
    id: 'mandelbulb',
    title: 'Raymarching the Mandelbulb',
    say: `The centrepiece is a Mandelbulb, a three-dimensional fractal.
      Its power controls how many lobes it grows, and we'll let it wander slowly: add an Expression node, name it Bulb Power, wire Time into a, and type 8 plus 1.5 times the sine of a times 0.17.
      Now a second Custom GLSL node, named Mandelbulb, with U V on input 0, Time on input 1, and Bulb Power on input 2.
      Paste its code.
      For every pixel it marches a ray from a camera circling the fractal, stepping by a distance estimate until it touches the surface.
      Then it shades what it hit: an orbit trap picks the gold and violet colours, there's a fresnel rim, a specular highlight, and a glow from the near misses.
      It returns four numbers, a colour and whether the ray hit, so its Output Type is vec4.
      Wire it to the Output for a moment, to see it on its own.`,
    async run(d) {
      await d.at(1);
      await place(d, 'power', 'expression');
      await d.rename(N.power, 'Bulb Power');
      await d.wire(N.time, 0, N.power, 0);
      await d.openParams(N.power);
      await d.setParam('Expression', expr('Bulb Power'));
      await closeParams(d);
      await d.at(2);
      await place(d, 'bulb', 'custom glsl');
      await d.rename(N.bulb, 'Mandelbulb');
      await d.wire(N.uv, 0, N.bulb, 0);
      await d.wire(N.time, 0, N.bulb, 1);
      await d.wire(N.power, 0, N.bulb, 2);
      await d.at(3);
      await d.openParams(N.bulb);
      await d.pasteParam('Code', code('Mandelbulb'));
      await d.at(6);
      await d.selectParam('Output Type', 'vec4');
      await closeParams(d);
      await d.at(7);
      await d.wire(N.bulb, 0, N.output, 0);
      await d.wait(4);
    },
  },

  {
    id: 'grade',
    title: 'Sparks and the final grade',
    say: `Two more nodes finish the picture.
      Another Expression, named Crystal Sparks, turns the Voronoi cells into thin bright edges: wire Voronoi into a, and type e to the minus a squared times 900, times 0.9.
      The last Custom GLSL node is Lens and Grade.
      Wire the Nebula into input 0, the Mandelbulb into input 1, the sparks into input 2, and U V into input 3.
      Its code lays the fractal over the clouds, lifts the highlights into a soft bloom, tone-maps with the ACES curve, and adds a vignette and a touch of film grain.
      Set its Output Type to vec3, and wire it into the Output.
      That's the whole picture, and it already moves on its own.`,
    async run(d) {
      await d.at(1);
      await place(d, 'sparks', 'expression');
      await d.rename(N.sparks, 'Crystal Sparks');
      await d.wire(N.voronoi, 0, N.sparks, 0);
      await d.openParams(N.sparks);
      await d.setParam('Expression', expr('Crystal Sparks'));
      await closeParams(d);
      await d.at(2);
      await place(d, 'grade', 'custom glsl');
      await d.rename(N.grade, 'Lens & Grade');
      await d.at(3);
      await d.wire(N.nebula, 0, N.grade, 0);
      await d.wire(N.bulb, 0, N.grade, 1);
      await d.wire(N.sparks, 0, N.grade, 2);
      await d.wire(N.uv, 0, N.grade, 3);
      await d.at(4);
      await d.openParams(N.grade);
      await d.pasteParam('Code', code('Lens & Grade'));
      await d.at(5);
      await d.selectParam('Output Type', 'vec3');
      await closeParams(d);
      await d.wire(N.grade, 0, N.output, 0);
      await d.at(6);
      await d.highlight('.floating-gpu-preview', 'Bulb Nebula');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  {
    id: 'listen',
    title: 'Listening to the song',
    say: `Now let's make it listen.
      Open Tools, Audio, choose the track, and press Play.
      Every meter below is a channel of the live analysis: overall level, three frequency bands, and a kick, a snare and a hi-hat, each detected separately.
      A drum fires when its meter crosses its threshold, so the threshold should sit above where the meter idles and below its peaks.
      Thresholds live on an Audio node, so add one from here, and its parameters open beside the meters.
      This song's kick is soft, so lower Kick Thresh to 0.35, and its hats sit low under the pads, so lower Hat Thresh to 0.25.`,
    async run(d) {
      await d.at(1);
      await openAudio(d);
      const panel = d.page.locator('#audio-settings-panel');
      await d.click(panel.locator('[data-source="file"]').first(), { settle: 300 });
      await d.chooseFile(panel.locator('.rzap-file-btn').first(), music);
      await d.click('#audio-playpause', { settle: 600 });
      await d.at(2);
      await d.highlight('#audio-channels', 'Channels');
      await d.at(3);
      await d.clearHighlights();
      await d.highlight(panel.locator('.rzap-row[data-channel="kickMeter"]').first(), 'Kick meter');
      await d.at(4);
      await d.clearHighlights();
      await d.click('#audio-add-setup', { settle: 800 });
      N.audio = (await d.node('Audio'))?.id;
      await d.at(5);
      await d.click('#audio-add-setup', { settle: 800 }); // "Edit on Audio #…" opens its parameters
      for (const [label, value] of Object.entries(AUDIO_SETTINGS)) await d.setParam(label, value);
      await d.highlight(panel.locator('.rzap-row[data-channel="kickMeter"]').first(), 'Threshold');
      await d.wait(2.5);
      await d.clearHighlights();
    },
  },

  {
    id: 'taps',
    title: 'Audio Value nodes',
    say: `To bring a channel into the patch, press the plus beside it.
      We want three: the kick, the snare, and the hat.
      Each one drops an Audio Value node on the canvas, a single number that follows its channel, and rises to one on a hit before falling smoothly back.
      Line them up on the left.
      The kick goes to two places: into the Mandelbulb's free input 3, and into the Nebula, which needs one more input, so press the plus under its pins.
      The snare drives Lens and Grade, also through a new input 4, and Bulb Power's pin b.
      And the hat goes to the b pin of Crystal Sparks.`,
    async run(d) {
      const panel = d.page.locator('#audio-settings-panel');
      const before = new Set((await d.nodes()).map((n) => n.id));
      for (const ch of ['kick', 'snare', 'hat']) {
        if (ch === 'snare') await d.at(1);
        await d.click(panel.locator(`.rzap-row[data-channel="${ch}"] .rzap-add`).first(), { settle: 700 });
      }
      const added = (await d.nodes()).filter((n) => !before.has(n.id) && n.kind === 'AudioValue');
      [N.kick, N.snare, N.hat] = added.map((n) => n.id);
      await d.at(2);
      await d.closeWindow('#audio-settings-panel');
      await closeParams(d);
      await d.at(3);
      if (N.audio) await d.moveNode(N.audio, ...AT.audio);
      for (const k of ['kick', 'snare', 'hat']) await d.moveNode(N[k], ...AT[k]);
      await d.at(4);
      await d.wire(N.kick, 0, N.bulb, 3);
      await d.addPin(N.nebula);
      await d.wire(N.kick, 0, N.nebula, 4);
      await d.at(5);
      await d.addPin(N.grade);
      await d.wire(N.snare, 0, N.grade, 4);
      await d.wire(N.snare, 0, N.power, 1);
      await d.at(6);
      await d.wire(N.hat, 0, N.sparks, 1);
    },
  },

  {
    id: 'code',
    title: 'Making the shaders listen',
    say: `Wires alone change nothing, until the code reads them.
      In the Mandelbulb, name input 3 kick, lengthen the lens by 0.4 times kick so every kick zooms in, and multiply the glow by one plus 1.8 times kick.
      In the Nebula, read input 4 as kick too, and use it to burn the filaments brighter and swell the whole cloud.
      In Lens and Grade, input 4 is the snare, and it pushes the exposure for a flash on the backbeat.
      Bulb Power adds b times 0.6, so the snare kicks the fractal into a slightly different shape.
      And Crystal Sparks scales its edges by 0.4 plus 1.8 times b, so they glint with the hats.`,
    async run(d) {
      const edit = async (id, key) => {
        await d.openParams(id);
        const field = ['Bulb Power', 'Crystal Sparks'].includes(key) ? 'Expression' : 'Code';
        for (const e of AUDIO_EDITS[key]) await d.editCode(field, e.find, e.text, { after: e.after });
        await closeParams(d);
      };
      await d.at(1);
      await edit(N.bulb, 'Mandelbulb');
      await d.at(2);
      await edit(N.nebula, 'Nebula');
      await d.at(3);
      await edit(N.grade, 'Lens & Grade');
      await d.at(4);
      await edit(N.power, 'Bulb Power');
      await d.at(5);
      await edit(N.sparks, 'Crystal Sparks');
    },
  },

  {
    id: 'finale',
    title: 'The finished patch',
    say: `That's Bulb Nebula, listening.
      Everything that reacts is an ordinary wire into ordinary code, so every amount can be pushed further or pulled back, and any Audio Value can be switched to another channel from its parameters.
      Save the patch with Control S, and it keeps the thresholds on its Audio node, ready for the next time this track plays.
      Thanks for watching.`,
    async run(d) {
      // Back to the top of the track, for a clean run at the result.
      await d.page.evaluate(async () => {
        const { getBrowserAudioCapture } = await import('/src/audio/BrowserAudioCapture.js');
        const el = getBrowserAudioCapture()?.audioElement;
        if (el) el.currentTime = 0;
      }).catch(() => {});
      await fullscreen(d);
      await d.at(3, 4);
      await fullscreen(d);
      await d.card(`<h1>Bulb Nebula</h1><p>Made in Rhizomium <span class="accent">·</span> studio.tenderworld.org</p>`);
      // What was built, for comparison with the finished patch file.
      await d.safe('export', async () => {
        const out = join(HERE, 'build');
        mkdirSync(out, { recursive: true });
        const project = await d.page.evaluate(() => window.saveLoadManager.exportProject());
        writeFileSync(join(out, 'bulb-nebula-built.rz'), JSON.stringify(project, null, 2));
      });
    },
  },
];
