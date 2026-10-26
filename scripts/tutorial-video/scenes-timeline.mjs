// Timeline and keyframes: setting keyframes by hand, interpolation, looping,
// record mode and staggered animation. About seven minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-timeline.mjs --out scripts/tutorial-video/build/08timeline
//
// Same format as scenes.mjs. It follows docs/timeline.md where the editor
// does what it says, and the editor where it doesn't: keyframes are added with
// the round button beside each parameter (there is no K shortcut), easing is
// chosen by right-clicking a keyframe, and Record is the timeline's fourth
// button. Every narration line is one sentence, so `at(n)` counts lines.

export const title = 'Rhizomium: timeline and keyframes';
export const name = 'rhizomium-timeline';

export const lexicon = {
  'In-Out': 'in out',
};

// Graph (0, 0) sits just under the preview window, scaled down so both rows
// clear the docked timeline.
const VIEW = { scale: 0.74, x: 170, y: 472 };
const BLANK = { x: 1500, y: 300 }; // empty canvas, right of the preview window
const COL = 270;
const TIMELINE_HEIGHT = 262;

const RAMP = [
  { position: 0.0, color: [0.05, 0.02, 0.16, 1] },
  { position: 0.45, color: [0.13, 0.88, 0.94, 1] },
  { position: 1.0, color: [1.0, 0.25, 0.62, 1] },
];
const n = (id, kind, col, row, params = {}) => ({ id, kind, x: col * COL, y: row * 270, params });
const c = (a, ap, z, zp) => ({ from: { nodeId: a, pin: ap }, to: { nodeId: z, pin: zp } });

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
const TL = '#timeline-panel';
const button = (d, i) => d.page.locator(`${TL} .timeline-controls .timeline-button`).nth(i);
const RECORD = `${TL} .timeline-record-button`;

/**
 * A point on the timeline canvas, in client pixels: on the ruler (below the
 * loop markers, which take clicks in its top 15 px), or on a lane.
 */
const tlPoint = (d, time, lane = null) => d.page.evaluate(([t, lane]) => {
  const p = window.timelinePanel;
  const r = p.canvas.getBoundingClientRect();
  const y = lane === null ? r.top + 22 : r.top + p.rulerHeight + lane * p.trackHeight + p.trackHeight / 2;
  return { x: Math.max(r.left + 1, r.left + p.timeToX(t)), y };
}, [time, lane]);

/** The lane index of a node's parameter, by node kind. */
const lane = (d, kind, param) => d.page.evaluate(([kind, param]) => window.timelineManager.timeline.tracks
  .findIndex((t) => t.paramName === param && window.editor.graph.nodes.find((n) => n.id === t.nodeId)?.kind === kind), [kind, param]);

/** A rectangle over part of the timeline canvas: a lane, or the whole height. */
const tlRect = (d, t0, t1, laneIndex = null) => d.page.evaluate(([t0, t1, li]) => {
  const p = window.timelinePanel;
  const r = p.canvas.getBoundingClientRect();
  const x0 = r.left + p.timeToX(t0);
  const x1 = r.left + p.timeToX(t1);
  return li === null
    ? { x: x0, y: r.top, width: x1 - x0, height: r.height }
    : { x: x0, y: r.top + p.rulerHeight + li * p.trackHeight, width: x1 - x0, height: p.trackHeight };
}, [t0, t1, laneIndex]);

/** A rectangle around several elements. */
const around = (d, selectors) => d.page.evaluate((sels) => {
  const rs = sels.map((s) => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
  const x = Math.min(...rs.map((r) => r.left));
  const y = Math.min(...rs.map((r) => r.top));
  return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y };
}, selectors);

/**
 * Open a node's parameters. A double-click that lands as the start of a drag
 * moves the node instead, so the node is put back and the double-click tried
 * again, on its title bar, until the panel shows it.
 */
async function openNode(d, kind) {
  const nid = await id(d, kind);
  if (!nid) return;
  const home = (await d.nodes()).find((n) => n.id === nid);
  for (let attempt = 0; attempt < 3; attempt++) {
    await d.page.mouse.up().catch(() => {});
    await d.dblclick(attempt === 0 ? await d.body(nid) : await d.title(nid), { settle: 700 });
    const state = await d.page.evaluate((nid) => ({
      open: window.editor.paramPanel?.selectedNode?.id === nid,
      node: window.editor.graph.nodes.find((n) => n.id === nid),
    }), nid);
    if (state.node && (state.node.x !== home.x || state.node.y !== home.y)) {
      await d.page.evaluate(([nid, x, y]) => {
        const n = window.editor.graph.nodes.find((n) => n.id === nid);
        n.x = x;
        n.y = y;
        window.editor.markDirty?.('tour-restore');
      }, [nid, home.x, home.y]);
    }
    if (state.open) return;
    d.warnings.push(`[${d.scene?.id}] open ${kind}: retry ${attempt + 1}`);
  }
}

/**
 * Drag on the timeline in a few coarse steps. Every step moves the playhead or a
 * keyframe and redraws the open parameter panel, so the director's usual
 * pointer-rate drag would crawl.
 */
async function coarseDrag(d, from, to, { ms = 1200, steps = 20 } = {}) {
  return d.safe('timeline drag', async () => {
    await d.move(from);
    await d.page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const p = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      await d.page.mouse.move(p.x, p.y);
      d.mouse = p;
      await d.wait(ms / steps / 1000);
    }
    await d.page.mouse.up();
    await d.wait(0.25);
  });
}

const seek = async (d, t) => d.click(await tlPoint(d, t), { settle: 250 });

/** Type a value into a parameter and press its keyframe button. */
async function keyframe(d, label, value) {
  // The panel is short and scrolls: a lower parameter has to be brought into view first.
  await d.safe(`scroll to ${label}`, () => d.paramBlock(label).scrollIntoViewIfNeeded({ timeout: 2000 }));
  await d.setParam(label, String(value));
  await d.click(d.paramBlock(label).locator('.keyframe-btn'), { settle: 300 });
}

const playing = (d) => d.page.evaluate(() => window.timelineManager.isPlaying()).catch(() => false);
const play = async (d) => { if (!(await playing(d))) await d.click(button(d, 0), { settle: 300 }); };
const pause = async (d) => { if (await playing(d)) await d.click(button(d, 0), { settle: 300 }); };

const menuItem = (d, label) => d.page.locator('.timeline-context-menu-item', { hasText: label }).first();

/** Right-click the keyframe at `time` on a lane. */
async function keyframeMenu(d, laneIndex, time) {
  return d.rightClick(await tlPoint(d, time, laneIndex), { settle: 400 });
}

/**
 * Hold Shift and Alt and drag a number field down and back, `cycles` times,
 * for `seconds`. Shift+drag scrubs a number; Alt makes each pixel 0.1.
 */
async function scrub(d, field, { seconds, depth, cycles }) {
  return d.safe('scrub', async () => {
    const p = await d.point(field);
    await d.move(p);
    await d.page.keyboard.down('Shift');
    await d.page.keyboard.down('Alt');
    await d.page.mouse.down();
    const t0 = Date.now();
    for (;;) {
      const k = (Date.now() - t0) / 1000 / seconds;
      if (k >= 1) break;
      const dy = depth * (1 - Math.cos(2 * Math.PI * cycles * k)) / 2;
      await d.page.mouse.move(p.x, p.y + dy);
      d.mouse = { x: p.x, y: p.y + dy };
      await d.wait(0.03);
    }
    await d.page.mouse.move(p.x, p.y);
    await d.page.mouse.up();
    await d.page.keyboard.up('Alt');
    await d.page.keyboard.up('Shift');
  });
}

export default [
  {
    id: 'intro',
    title: 'Timeline and keyframes',
    chapter: false,
    say: `The timeline turns a still patch into a performance that plays itself.
      You set values at moments in time, called keyframes, and Rhizomium moves smoothly between them.
      In this video we'll set keyframes by hand, choose how they ease, loop them, record a gesture live, and stagger several animations into a cascade.`,
    async run(d) {
      await d.card(`<h1>Timeline and keyframes</h1><p>Rhizomium <span class="accent">·</span> make a patch move on its own</p>`);
      await d.safe('new graph', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
      });
      await d.safe('load patch', () => d.page.evaluate(async (patch) => {
        const { replaceGraphWithPatch } = await import('/src/ai/applyResult.js');
        await replaceGraphWithPatch(patch, { title: 'Timeline and keyframes', reason: 'tutorial' });
      }, PATCH));
      await d.safe('timeline height', () => d.page.evaluate((h) => {
        window.timelinePanel.height = h;
        window.timelinePanel.updateLayout();
      }, TIMELINE_HEIGHT));
      await d.wait(0.6);
      await setView(d, VIEW);
      await d.at(2);
      await d.card(`<h1>Timeline and keyframes</h1><ol>
        <li>Keyframes by hand</li><li>Interpolation</li><li>Looping</li>
        <li>Record mode</li><li>Staggered animation</li></ol>`);
      await d.wait(7);
      await d.card('');
    },
  },

  {
    id: 'patch',
    title: 'The patch',
    say: `Here's the patch from the earlier videos.
      A Circle masks a field of Voronoi cells, the cells turn through a Rotate 2D node, and a Gradient colours the result.
      We'll animate three of its numbers: the Circle's Radius, the cells' Scale, and the Rotation.
      Right now all three hold still.`,
    async run(d) {
      await d.at(1);
      for (const [kind, label] of [['Circle', 'Circle'], ['VoronoiNoise', 'Voronoi cells'], ['Rotate2D', 'Rotate 2D'], ['ComputeGradient', 'Gradient']]) {
        const nid = await id(d, kind);
        if (nid) await d.highlight(await d.nodeRect(nid, 175), label);
        await d.wait(1);
        await d.clearHighlights();
      }
      await d.at(3);
      await d.highlight(PREVIEW, 'Still');
      await d.wait(2);
      await d.clearHighlights();
    },
  },

  {
    id: 'open',
    title: 'The timeline panel',
    say: `Open the timeline from View, Timeline, or press Control Alt T.
      It docks along the bottom of the window.
      On the left are Play, Stop, Loop and Record.
      Next to them is the playhead's time, then the Duration of the whole timeline, ten seconds to start with, and its frame rate.
      Enable Timeline switches the playback of keyframes on and off.
      The ruler below shows time in seconds, and each animated parameter gets a lane of its own.
      Click Enable Timeline now, so we can see what we build.`,
    async run(d) {
      await d.menu('View', 'Timeline');
      await d.at(1);
      await d.highlight(TL, 'Timeline');
      await d.at(2);
      await d.clearHighlights();
      await d.highlight(await around(d, [`${TL} .timeline-controls .timeline-button:nth-of-type(1)`, RECORD]), 'Play · Stop · Loop · Record');
      await d.at(3);
      await d.clearHighlights();
      await d.highlight(`${TL} .timeline-time-display`, 'Playhead');
      await d.wait(1.6);
      await d.clearHighlights();
      await d.highlight(`${TL} .timeline-duration-input`, 'Duration');
      await d.wait(1.8);
      await d.clearHighlights();
      await d.highlight(`${TL} .timeline-fps-input`, 'Frame rate');
      await d.at(4);
      await d.clearHighlights();
      await d.highlight(`${TL} .timeline-enable-toggle`, 'Enable Timeline');
      await d.at(5);
      await d.clearHighlights();
      await d.highlight(`${TL} .timeline-canvas`, 'Ruler and lanes');
      await d.at(6);
      await d.clearHighlights();
      await d.click(`${TL} .timeline-enable-toggle`, { settle: 400 });
    },
  },

  // docs/timeline.md - Quick Start, Method 2: Manual Keyframes
  {
    id: 'keys',
    title: 'Keyframes by hand',
    say: `Let's make the circle breathe.
      Double-click the Circle to open its parameters.
      Beside Radius is a round keyframe button.
      It stores the value in the field at the playhead's current time.
      With the playhead at zero, set Radius to 0.1, and press the button.
      A diamond appears in a new lane, Circle Radius.
      Click the ruler at two seconds, set Radius to 0.4, and press it again.
      Then at four seconds, back to 0.1.
      The line through the diamonds is the value the timeline will play.
      Drag the playhead, and the circle follows: growing towards two seconds, and shrinking after.
      Press Play, and it runs on its own.`,
    async run(d) {
      await d.at(1);
      await openNode(d, 'Circle');
      await d.at(2);
      await d.highlight(d.paramBlock('Radius').locator('.keyframe-btn'), 'Keyframe');
      await d.at(4);
      await d.clearHighlights();
      await seek(d, 0);
      await keyframe(d, 'Radius', 0.1);
      await d.at(5);
      await d.highlight(await tlRect(d, 0, 10, 0), 'Circle · Radius');
      await d.wait(2);
      await d.clearHighlights();
      await d.at(6);
      await seek(d, 2);
      await keyframe(d, 'Radius', 0.4);
      await d.at(7);
      await seek(d, 4);
      await keyframe(d, 'Radius', 0.1);
      await d.at(8);
      await d.highlight(await tlRect(d, 0, 4.1, 0), 'The animated value');
      await d.wait(2.5);
      await d.clearHighlights();
      await d.at(9);
      await coarseDrag(d, await tlPoint(d, 4), await tlPoint(d, 2), { ms: 1500 });
      await coarseDrag(d, await tlPoint(d, 2), await tlPoint(d, 0), { ms: 1500 });
      await d.at(10);
      await play(d);
      await d.highlight(PREVIEW, 'Breathing');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/timeline.md - Keyframe Interpolation
  {
    id: 'easing',
    title: 'Interpolation',
    say: `Between two keyframes, the value doesn't have to move at a steady speed.
      Right-click a diamond to choose how it eases into the next one.
      Linear moves at a constant speed, which can look mechanical.
      Ease In starts slowly and speeds up.
      Ease Out starts quickly and settles gently into the next value.
      Ease In-Out does both: slow at each end and quick in the middle, which is how most natural movement looks.
      Step doesn't blend at all: it holds the value, then jumps when the next keyframe arrives.
      Watch the lane, and the line bends to show it.
      For a breath, Ease In-Out is the one, so let's set it on the first two keyframes.
      Now the circle swells and settles, instead of bouncing between two speeds.`,
    async run(d) {
      await d.at(1);
      await keyframeMenu(d, 0, 0);
      for (const [i, label] of [[2, 'Linear'], [3, 'Ease In'], [4, 'Ease Out'], [5, 'Ease In-Out'], [6, 'Step']]) {
        await d.at(i);
        await d.clearHighlights();
        await d.highlight(menuItem(d, label), label, { pad: 2 });
      }
      await d.at(6, 2.5);
      await d.clearHighlights();
      await d.click(menuItem(d, 'Step'), { settle: 400 });
      await d.at(7);
      await d.highlight(await tlRect(d, 0, 4.1, 0), 'Step: hold, then jump');
      await d.wait(3);
      await d.clearHighlights();
      await d.at(8);
      await keyframeMenu(d, 0, 0);
      await d.click(menuItem(d, 'Ease In-Out'), { settle: 400 });
      await keyframeMenu(d, 0, 2);
      await d.click(menuItem(d, 'Ease In-Out'), { settle: 400 });
      await d.at(9);
      await d.highlight(await tlRect(d, 0, 4.1, 0), 'Ease In-Out');
      await d.wait(2.5);
      await d.clearHighlights();
    },
  },

  // docs/timeline.md - Loop, Looping Animations
  {
    id: 'loop',
    title: 'Looping',
    say: `The timeline is ten seconds long, but our animation ends at four.
      So after one breath, the circle sits still for six seconds before the timeline starts over.
      The Loop button is on by default, and the shaded band across the ruler is the loop region.
      Set its end to four in the Loop fields, and the playhead wraps from four seconds straight back to zero.
      You can also drag the markers at either end of the band.
      For a seamless loop, make the last keyframe match the first.
      Our Radius starts and ends at 0.1, so the breathing never jumps.
      Turn Loop off, and the timeline plays to the end once, and stops.`,
    async run(d) {
      await d.at(1);
      await d.highlight(await tlRect(d, 4, 10), 'Nothing happens here');
      await d.at(2);
      await d.clearHighlights();
      await d.highlight(button(d, 2), 'Loop');
      await d.wait(1.5);
      await d.clearHighlights();
      await d.highlight(await tlRect(d, 0, 10), 'Loop region');
      await d.at(3);
      await d.clearHighlights();
      const end = d.page.locator(`${TL} .timeline-loop-input`).nth(1);
      await d.highlight(end, 'Loop end');
      await d.safe('loop end', async () => {
        await d.click(end, { settle: 150 });
        await d.page.keyboard.press('Control+A');
        await d.type('4', { delay: 120 });
        await d.key('Enter', 400);
      });
      await d.clearHighlights();
      await d.highlight(await tlRect(d, 0, 4), '0 – 4 s');
      await d.at(4);
      await d.clearHighlights();
      const marker = await tlPoint(d, 4);
      await d.highlight({ x: marker.x - 14, y: marker.y - 22, width: 18, height: 18 }, 'Drag to move');
      await d.at(5);
      await d.clearHighlights();
      await d.highlight(await tlRect(d, -0.1, 0.1, 0), 'First');
      await d.wait(1.5);
      await d.clearHighlights();
      await d.highlight(await tlRect(d, 3.9, 4.1, 0), 'Last');
      await d.at(6, 2);
      await d.clearHighlights();
      await d.at(7);
      await d.highlight(button(d, 2), 'Loop on / off');
      await d.wait(3);
      await d.clearHighlights();
      await pause(d);
    },
  },

  // docs/timeline.md - Method 1: Record Mode
  {
    id: 'record',
    title: 'Record mode',
    say: `Setting keyframes one at a time is precise, but sometimes you'd rather perform the movement.
      That's what Record mode is for.
      Open Rotate 2D, and click the Record button.
      It turns red while it's armed.
      Now press Play, and change a value while the timeline runs.
      To scrub a number field, hold Shift and drag up or down on it.
      Hold Alt as well, and it moves ten times faster.
      Every change becomes a keyframe, ten of them a second, and the timeline leaves the parameter alone while your hand is on it.
      Click Record again to stop.
      Now the cells turn exactly the way you moved them, on every pass of the loop.
      Recording works while paused, too: a value you type lands as a single keyframe at the playhead.
      And a whole recording pass undoes in one step, with Control Z.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await d.at(2);
      await openNode(d, 'Rotate2D');
      await d.click(RECORD, { settle: 400 });
      await d.at(3);
      await d.highlight(RECORD, 'Armed');
      await d.at(4);
      await d.clearHighlights();
      await seek(d, 0);
      await play(d);
      await d.at(5);
      await d.highlight(d.paramBlock('Rotation'), 'Shift + Alt + drag');
      await scrub(d, d.paramField('Rotation'), { seconds: 3.8, depth: 320, cycles: 2 });
      await d.clearHighlights();
      await d.at(7);
      const rot = await lane(d, 'Rotate2D', 'rotation');
      if (rot >= 0) await d.highlight(await tlRect(d, 0, 4.1, rot), 'Recorded');
      await d.at(8);
      await d.clearHighlights();
      await d.click(RECORD, { settle: 400 });
      await d.at(9);
      await d.highlight(PREVIEW, 'Playing back the gesture');
      await d.at(10);
      await d.clearHighlights();
      await d.at(11);
      await d.card(`<h1>Record</h1><ul>
        <li>Playing: a keyframe every 0.1 s while you move a value</li>
        <li>Paused: one keyframe at the playhead</li>
        <li><code>Ctrl + Z</code> undoes the whole pass</li></ul>`);
      await d.at(11, 4);
      await d.card('');
    },
  },

  // docs/timeline.md - Staggered Animations
  {
    id: 'stagger',
    title: 'Staggered animation',
    say: `Last, staggered animation: the same movement, started a little later on each parameter, so it ripples through the picture.
      Open the Voronoi node.
      Keyframe its Scale just like the radius: 4 at zero, 10 at two seconds, and back to 4 at four.
      Right now the cells and the circle peak at the same moment, so they move as one block.
      Drag the middle Scale diamond half a second later, to two and a half seconds.
      Now the circle swells first, and the cells follow.
      Add a third lane, the Circle's Softness.
      Keyframe it at 0.04 at zero, 0.3 at three seconds, and back to 0.04 at four.
      Its peak lands a second after the circle's, so the edge softens last.
      Size, then cells, then softness: one breath rolling through three parameters.
      The offsets are what make it read as a single motion, rather than three things happening at once.`,
    async run(d) {
      await pause(d);
      await d.click(BLANK, { settle: 300 });
      await d.at(0, 4);
      await openNode(d, 'VoronoiNoise');
      await d.at(1, 1.5);
      await seek(d, 0);
      await keyframe(d, 'Scale', 4);
      await seek(d, 2);
      await keyframe(d, 'Scale', 10);
      await seek(d, 4);
      await keyframe(d, 'Scale', 4);
      await d.at(3);
      const scale = await lane(d, 'VoronoiNoise', 'scale');
      await d.highlight(await tlRect(d, 1.85, 2.15, null), 'Both peak at 2 s');
      await d.at(4);
      await d.clearHighlights();
      await coarseDrag(d, await tlPoint(d, 2, scale), await tlPoint(d, 2.5, scale), { ms: 1000, steps: 12 });
      await d.at(5);
      await seek(d, 0);
      await play(d);
      await d.highlight(PREVIEW, 'Circle, then cells');
      await d.at(6);
      await d.clearHighlights();
      await pause(d);
      await d.click(BLANK, { settle: 300 });
      await openNode(d, 'Circle');
      await d.at(6, 1);
      await seek(d, 0);
      await keyframe(d, 'Softness', 0.04);
      await seek(d, 3);
      await keyframe(d, 'Softness', 0.3);
      await seek(d, 4);
      await keyframe(d, 'Softness', 0.04);
      await d.at(8);
      await seek(d, 0);
      await play(d);
      await d.at(9);
      await d.highlight(await tlRect(d, 0, 4.1, null), '2 s · 2.5 s · 3 s');
      await d.at(10);
      await d.clearHighlights();
      await d.highlight(PREVIEW, 'One breath, three parameters');
      await d.at(10, 3);
      await d.clearHighlights();
    },
  },

  // docs/timeline.md - Editing Keyframes
  {
    id: 'edit',
    title: 'Editing keyframes',
    say: `Keyframes stay editable after you've set them.
      Drag a diamond along its lane to move it in time.
      Right-click it and choose Delete keyframe to remove it, and the line redraws without it.
      Control Z brings it back.
      The Seconds button switches the time displays to frames, for when you're counting frames rather than seconds.
      And Duration sets the length of the whole timeline: make it longer when a piece needs more room.`,
    async run(d) {
      await pause(d);
      await d.click(BLANK, { settle: 300 });
      const soft = await lane(d, 'Circle', 'epsilon');
      await d.at(1);
      if (soft >= 0) {
        await d.highlight(await tlRect(d, 2.8, 3.6, soft), 'Drag');
        await coarseDrag(d, await tlPoint(d, 3, soft), await tlPoint(d, 3.4, soft), { ms: 900, steps: 10 });
        await coarseDrag(d, await tlPoint(d, 3.4, soft), await tlPoint(d, 3, soft), { ms: 900, steps: 10 });
        await d.clearHighlights();
      }
      await d.at(2);
      if (soft >= 0) {
        await keyframeMenu(d, soft, 3);
        await d.highlight(menuItem(d, 'Delete keyframe'), 'Delete', { pad: 2 });
        await d.wait(1.2);
        await d.clearHighlights();
        await d.click(menuItem(d, 'Delete keyframe'), { settle: 400 });
        await d.highlight(await tlRect(d, 0, 4.1, soft), 'Gone');
      }
      await d.at(3);
      await d.clearHighlights();
      await d.click(BLANK, { settle: 200 });
      await d.key('Control+z', 500);
      if (soft >= 0) await d.highlight(await tlRect(d, 0, 4.1, soft), 'Back');
      await d.at(4);
      await d.clearHighlights();
      await d.click(`${TL} .timeline-display-mode-toggle`, { settle: 400 });
      await d.highlight(await around(d, [`${TL} .timeline-time-display`, `${TL} .timeline-display-mode-toggle`]), 'Frames');
      await d.at(5);
      await d.clearHighlights();
      await d.click(`${TL} .timeline-display-mode-toggle`, { settle: 300 });
      await d.highlight(`${TL} .timeline-duration-input`, 'Duration');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  {
    id: 'tips',
    title: 'Good to know',
    say: `A few things worth knowing.
      Keyframes are saved with the project, so Control S keeps the whole animation.
      Disable Timeline stops the keyframes playing without losing any of them, for when you want to set values by hand.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await d.at(1);
      await d.card(`<h1>Good to know</h1><ul>
        <li><code>Ctrl + S</code> saves the keyframes with the project</li>
        <li><b>Disable Timeline</b> pauses keyframes, keeps them</li></ul>`);
      await d.at(2, 5);
      await d.card('');
    },
  },

  {
    id: 'outro',
    title: 'Next steps',
    say: `That's the timeline: keyframes, easing, loops, recording and staggering.
      Build a breath, then let it play.`,
    async run(d) {
      await d.at(0, 2);
      await d.card(`<h1>Ctrl + Alt + T</h1><p>Keyframes <span class="accent">·</span> easing <span class="accent">·</span> loop <span class="accent">·</span> record <span class="accent">·</span> stagger</p>`);
    },
  },
];
