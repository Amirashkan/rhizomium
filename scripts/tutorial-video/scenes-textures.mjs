// Images and video as textures: the Texture 2D node, video playback, trim, and
// re-cueing a clip with an expression. About four minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-textures.mjs --out scripts/tutorial-video/build/09textures --audio-file scripts/tutorial-video/build/06audio/media/reel-bright18.wav
//
// Same format as scenes.mjs. It follows docs/textures.md where the editor does
// what it says, and the editor where it doesn't:
//   - The panel shows File, Scale, Play, Loop, Speed, Sound, Trim Start, Trim
//     End and Reset (ParameterPanel's texture2d definitions). The Wrap and
//     Filter settings the docs describe aren't in it, and Scale changes nothing
//     in the preview, so the video leaves all three out.
//   - The docs' 24 MB inline limit is the browser's. The desktop app saves a
//     video by its path (core/mediaRefs.js), so that's what the video says.
//   - Each behaviour shown was tried in the live editor first: trim 3-6 loops
//     back to 3; Loop off holds on 6; toggling Play off and on plays the span
//     again; `=sin(time * PI) < 0` re-cues every 2 s; `=audioEnvelopeBass >
//     0.6` re-cues on the kicks of the mic feed below.
//
// The media is made by build/09textures/media/make-media.sh: a still, and a
// 12 s clip that shows its own time (a big counter, a progress bar, and a new
// hue and letter every 3 s), so trim and re-cue read off the preview. A file is
// chosen by clicking the drop zone and answering the file chooser from here,
// so no native dialog shows in the recording.
//
// The mic is Chrome's fake capture device playing --audio-file, as in
// scenes-expressions.mjs. The mic scene writes listen.json to --out for mixing
// the music back in (see the bottom of scenes-audio.mjs for the ffmpeg line).

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const title = 'Rhizomium: images and video as textures';
export const name = 'rhizomium-textures';

export const lexicon = {
  audioEnvelopeBass: 'audio envelope bass',
  MOV: 'M O V',
  WebM: 'web M',
  WebP: 'web P',
  JPG: 'J peg',
  MP4: 'M P 4',
  PNG: 'P N G',
  PI: 'pie',
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const argOut = process.argv.indexOf('--out');
const OUT = resolve(argOut > 0 ? process.argv[argOut + 1] : join(HERE, 'build/09textures'));
const MEDIA = join(OUT, 'media');

// Graph (0, 0) sits just under the preview window. The Texture 2D goes in the
// gap between the two nodes the patch starts with.
const VIEW = { scale: 1.15, x: 120, y: 520 };
const BLANK = { x: 1300, y: 300 }; // empty canvas, right of the preview window
const TEX_AT = { x: 470, y: 560 }; // where the palette is opened, in client px
const PANEL_HEIGHT = 1010;

const n = (id, kind, x, y, params = {}) => ({ id, kind, x, y, params });

const PATCH = {
  nodes: [n('7', 'UV', 0, 0), n('9', 'OutputFinal', 600, 0)],
  connections: [],
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
const PANEL = '#parameter-panel';
const DROP = `${PANEL} .file-drop-zone`;
const RESET = `${PANEL} .parameter-container[data-param="reset"]`;

const audio = (d) => d.page.locator('#audio-settings-panel');

/** Note when the mic opened, for mixing the music back in later. */
const markListen = (d) => writeFileSync(join(OUT, 'listen.json'), JSON.stringify({ listen: d.clock() }));

/** Tall enough that every control shows without scrolling. */
const tallPanel = (d) => d.page.evaluate((h) => {
  const p = document.getElementById('parameter-panel');
  if (p) p.style.height = `${h}px`;
}, PANEL_HEIGHT).catch(() => {});

/**
 * Click the drop zone and answer the file chooser it opens with `file`.
 *
 * The panel isn't redrawn after an upload, so a video's playback controls stay
 * dimmed until the node is selected again (they work either way). It is
 * redrawn here, so the recording shows them as a reselect would.
 */
async function choose(d, file) {
  return d.safe(`choose ${file}`, async () => {
    const chooser = d.page.waitForEvent('filechooser', { timeout: 5000 });
    await d.click(DROP, { settle: 100 });
    await (await chooser).setFiles(join(MEDIA, file));
    await d.wait(1.2);
    await d.page.evaluate(() => {
      const panel = window.editor.paramPanel;
      if (panel?.selectedNode) panel.renderParameters(panel.selectedNode);
    });
  });
}

/**
 * Scroll a control into the panel's view. The panel is shorter than its
 * controls, and a click on one hidden below its edge lands on the canvas and
 * closes the panel.
 */
const reveal = (d, target) => d.safe('reveal', () => (typeof target === 'string' ? d.page.locator(target).first() : target)
  .scrollIntoViewIfNeeded({ timeout: 2000 }));

/** Tick or untick a checkbox parameter (Play, Loop, Sound). */
async function toggle(d, label) {
  await reveal(d, d.paramBlock(label));
  await d.click(d.paramBlock(label).locator('input[type="checkbox"]'), { settle: 400 });
}

/** Set a parameter, scrolled into view first. */
async function set(d, label, value) {
  await reveal(d, d.paramBlock(label));
  await d.setParam(label, value);
}

/** Type into the expression field under Reset. Empty clears it. */
async function resetExpression(d, text, { delay = 75 } = {}) {
  return d.safe('reset expression', async () => {
    await reveal(d, RESET);
    await d.click(`${RESET} input`, { settle: 150 });
    await d.page.keyboard.press('Control+A');
    if (text) await d.type(text, { delay });
    else await d.key('Backspace', 100);
    await d.key('Enter', 500);
  });
}

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
    if (state.open) {
      await tallPanel(d);
      return;
    }
    d.warnings.push(`[${d.scene?.id}] open ${nid}: retry ${attempt + 1}`);
  }
}

/** Open the Texture 2D's parameters, if they aren't showing already. */
async function openTexture(d) {
  const open = await d.paramBlock('Trim Start').isVisible().catch(() => false);
  if (!open) await openNode(d, await id(d, 'Texture2D'));
}

export default [
  {
    id: 'intro',
    title: 'Images and video as textures',
    chapter: false,
    say: `Any picture or video file can become a texture in Rhizomium, and everything after it in the patch treats it the same way.
      In this video we'll load an image into a Texture 2D node, swap it for a video, trim the clip, and re-cue it with an expression.`,
    async run(d) {
      await d.card(`<h1>Images and video as textures</h1><p>Rhizomium <span class="accent">·</span> pictures and clips in your patch</p>`);
      await d.safe('new graph', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
      });
      await d.safe('load patch', () => d.page.evaluate(async (patch) => {
        const { replaceGraphWithPatch } = await import('/src/ai/applyResult.js');
        await replaceGraphWithPatch(patch, { title: 'Images and video', reason: 'tutorial' });
      }, PATCH));
      await d.wait(0.6);
      await setView(d, VIEW);
      await d.at(1);
      await d.card(`<h1>Images and video as textures</h1><ol>
        <li>The Texture 2D node</li><li>Video playback</li>
        <li>Trimming a clip</li><li>Re-cueing with an expression</li></ol>`);
      await d.wait(6);
      await d.card('');
    },
  },

  // docs/textures.md - Quick Start
  {
    id: 'node',
    title: 'The Texture 2D node',
    say: `We start with a UV node and the Output, and nothing between them.
      Right-click the canvas, type texture, and pick Texture 2D.
      Wire the UV into its UV input, and its Color output into the Output.
      Double-click the node to open its parameters.
      Click the drop zone and choose an image, or drag a file straight onto it.
      PNG, JPG and WebP all work, and the picture fills the preview straight away.
      The UV node decides where each pixel of the image lands, so anything that bends the UVs bends the picture too.`,
    async run(d) {
      await d.at(0, 0.5);
      for (const [kind, label] of [['UV', 'UV'], ['OutputFinal', 'Output']]) {
        const nid = await id(d, kind);
        if (nid) await d.highlight(await d.nodeRect(nid, 230), label);
        await d.wait(1.2);
        await d.clearHighlights();
      }
      await d.at(1);
      const tex = await d.addNode('texture', TEX_AT);
      await d.at(2);
      await d.wire(await id(d, 'UV'), 0, tex, 0);
      await d.wire(tex, 0, await id(d, 'OutputFinal'), 0);
      await d.at(3);
      await openNode(d, tex);
      await d.at(4);
      await d.highlight(DROP, 'Click or drop');
      await d.wait(1.5);
      await d.clearHighlights();
      await choose(d, 'poster.jpg');
      await d.at(5);
      await d.highlight(PREVIEW, 'poster.jpg');
      await d.at(6);
      await d.clearHighlights();
      await d.highlight(await d.nodeRect(await id(d, 'UV'), 230), 'Where each pixel lands');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/textures.md - Texture 2D, Video sources; Video Playback
  {
    id: 'video',
    title: 'Video playback',
    say: `Now the same node with a video.
      Click the drop zone again and choose an MP4, WebM or MOV file, and it starts playing at once.
      There's no separate video node: every frame is uploaded to the same texture, so whatever comes after it works exactly as it did with the still.
      This test clip shows its own time, so you can see what each control does.
      With a video loaded, the playback controls come into play.
      Play holds the clip on the frame it's showing, and runs it again.
      Speed sets the rate: 2 plays twice as fast, and 0.5 at half speed.
      Loop starts the clip over when it reaches the end, and it's on to begin with.
      Sound unmutes the video's own audio track, which starts muted.`,
    async run(d) {
      await d.at(1);
      await choose(d, 'clip.mp4');
      await d.highlight(PREVIEW, 'clip.mp4');
      await d.at(2);
      await d.clearHighlights();
      const tex = await id(d, 'Texture2D');
      if (tex) await d.highlight(await d.nodeRect(tex, 230), 'Still a texture');
      await d.at(3);
      await d.clearHighlights();
      await d.highlight(PREVIEW, 'Its own clock');
      await d.at(4);
      await d.clearHighlights();
      await d.highlight(await d.page.evaluate(() => {
        const boxes = ['Play', 'Sound'].map((l) => [...document.querySelectorAll('#parameter-panel .parameter-container')]
          .find((c) => c.querySelector('.parameter-label')?.textContent.trim().startsWith(l))?.getBoundingClientRect());
        if (!boxes[0] || !boxes[1]) return null;
        return { x: boxes[0].left, y: boxes[0].top, width: boxes[0].width, height: boxes[1].bottom - boxes[0].top };
      }), 'Playback');
      await d.at(5);
      await d.clearHighlights();
      await d.highlight(d.paramBlock('Play'), 'Play');
      await toggle(d, 'Play');
      await d.wait(1.6);
      await toggle(d, 'Play');
      await d.clearHighlights();
      await d.at(6);
      await d.highlight(d.paramBlock('Speed'), 'Speed');
      await set(d, 'Speed', '2');
      await d.wait(2.6);
      await set(d, 'Speed', '0.5');
      await d.wait(2.6);
      await set(d, 'Speed', '1');
      await d.clearHighlights();
      await d.at(7);
      await d.highlight(d.paramBlock('Loop'), 'Loop');
      await d.at(8);
      await d.clearHighlights();
      await d.highlight(d.paramBlock('Sound'), 'Sound');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/textures.md - Video Playback, Trim Start / Trim End
  {
    id: 'trim',
    title: 'Trimming a clip',
    say: `Often you only want part of a clip.
      Trim Start and Trim End pick it out, in seconds.
      Set Trim Start to 3, and Trim End to 6.
      Now only section B plays, from three seconds to six, and Loop takes it back to three rather than to zero.
      Speed still applies inside the trim.
      Trim End at zero means the end of the file, so Trim Start on its own plays from there to the end.
      Turn Loop off, and the clip plays the span once, and holds on its last frame.`,
    async run(d) {
      await openTexture(d);
      await d.at(1);
      await d.highlight(await d.page.evaluate(() => {
        const boxes = ['Trim Start', 'Trim End'].map((l) => [...document.querySelectorAll('#parameter-panel .parameter-container')]
          .find((c) => c.querySelector('.parameter-label')?.textContent.trim().startsWith(l))?.getBoundingClientRect());
        if (!boxes[0] || !boxes[1]) return null;
        return { x: boxes[0].left, y: boxes[0].top, width: boxes[0].width, height: boxes[1].bottom - boxes[0].top };
      }), 'Trim');
      await d.at(2);
      await d.clearHighlights();
      await set(d, 'Trim Start', '3');
      await set(d, 'Trim End', '6');
      await d.at(3);
      await d.highlight(PREVIEW, '3 s → 6 s, again and again');
      await d.at(4);
      await d.clearHighlights();
      await d.highlight(d.paramBlock('Speed'), 'Speed');
      await d.at(5);
      await d.clearHighlights();
      await d.highlight(d.paramBlock('Trim End'), '0 = end of file');
      await d.at(6);
      await d.clearHighlights();
      await toggle(d, 'Loop');
      await d.wait(3);
      await d.highlight(PREVIEW, 'Holding on 6 s');
      await d.wait(2.5);
      await d.clearHighlights();
    },
  },

  // docs/textures.md - Reset
  {
    id: 'reset',
    title: 'Re-cueing with an expression',
    say: `That held frame is where Reset comes in.
      Click it, and the clip rewinds to the start of its trim, and plays through again.
      Under the button is an expression field.
      Left empty, Reset only fires when you click it.
      Type an expression, and it's checked every frame: each time it rises past 0.5, the clip is re-cued.
      Turn Loop back on, and type: sin of time times PI, less than zero.
      That's true for one second in every two, so the clip jumps back to three seconds every two seconds, and never reaches six.
      Now let's re-cue it to music.
      Open Tools, Audio, choose Mic and line-in, and press Listen.
      Back on the Texture 2D, change the expression to audioEnvelopeBass, greater than 0.6.
      Every kick drum sends the clip back to three seconds, so it stutters in time with the beat.
      It's the same expression language as every other parameter, so equals node underscore and an ID would fire it from a Trigger somewhere else in the patch.`,
    async run(d) {
      await openTexture(d);
      await reveal(d, RESET);
      await d.highlight(`${RESET} button`, 'Reset');
      await d.at(1);
      await d.click(`${RESET} button`, { settle: 300 });
      await d.clearHighlights();
      await d.highlight(PREVIEW, 'From 3 s again');
      await d.at(2);
      await d.clearHighlights();
      await d.highlight(`${RESET} input`, 'Expression');
      await d.at(5);
      await d.clearHighlights();
      await toggle(d, 'Loop');
      await resetExpression(d, '=sin(time * PI) < 0');
      await d.at(6);
      await d.highlight(PREVIEW, 'Back to 3 s every 2 s');
      await d.at(7);
      await d.clearHighlights();
      // The parameter panel stays open: the Audio panel opens beside it.
      await d.at(8, -0.8);
      await d.menu('Tools', 'Audio', { hold: 400 });
      await d.wait(0.5);
      await d.click(audio(d).locator('.rzap-tab[data-source="mic"]'), { settle: 500 });
      await d.page.evaluate(() => Object.defineProperty(MediaStreamTrack.prototype, 'label', { get: () => 'Microphone' })).catch(() => {});
      await d.click(audio(d).locator('#audio-live-toggle'), { settle: 800 });
      markListen(d);
      await d.wait(0.8);
      await d.click('#audio-close-btn', { settle: 300 });
      await d.at(9);
      // Typed briskly: with the mic being analysed, each keystroke is slow to land.
      await resetExpression(d, '=audioEnvelopeBass > 0.6', { delay: 30 });
      await d.at(10);
      await d.highlight(PREVIEW, 'Re-cued on every kick');
      await d.at(11, 3);
      await d.clearHighlights();
      await d.card(`<h1>Reset expressions</h1><ul>
        <li><code>=audioEnvelopeBass &gt; 0.6</code> on the beat</li>
        <li><code>=node_12</code> from a Trigger</li>
        <li><code>=sin(time * PI) &lt; 0</code> on a fixed cycle</li></ul>`);
      await d.at(11, 8);
      await d.card('');
    },
  },

  // docs/textures.md - Video sources (saving)
  {
    id: 'save',
    title: 'Saving',
    say: `Trim, playback settings and the Reset expression are all saved with the project.
      The desktop app remembers the video by where it is on disk, rather than copying it in, so keep the file where it is, or move it along with the project.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await d.at(0, 0.5);
      await d.card(`<h1>Saved with the project</h1><ul>
        <li>Play, Loop, Speed, Sound, Trim, and the Reset expression</li>
        <li>The video by its path on disk: keep it with the project</li></ul>`);
      await d.at(1, 6);
      await d.card('');
    },
  },

  {
    id: 'outro',
    title: 'Next steps',
    say: `That's images and video as textures: load them, play them, trim them, and re-cue them with an expression.
      Drop in a clip of your own, and cut it to the music.`,
    async run(d) {
      await d.at(0, 2);
      await d.card(`<h1>Texture 2D</h1><p>Image <span class="accent">·</span> video <span class="accent">·</span> trim <span class="accent">·</span> re-cue</p>`);
    },
  },
];
