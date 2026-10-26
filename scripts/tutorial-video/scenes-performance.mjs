// Keeping it smooth live: the frame-rate readouts, the Compute Profiler, frame
// rate against display refresh, and the settings that buy performance back.
// About five minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-performance.mjs --out scripts/tutorial-video/build/11performance
//
// Same format as scenes.mjs. It follows docs/performance.md, docs/profiler.md
// and docs/frame-rate.md where the editor does what they say, and the editor
// where it doesn't:
//   - The preview's "ms GPU" is the interval between frame submissions
//     (FloatingGPUPreview's FPSCounter.frame), which the fixed-step loop paces
//     at ~60/s whatever the GPU costs: this patch reads 26 fps beside ~16 ms
//     GPU. So the narration leaves that number alone, and the "is it my patch
//     or my display" test (docs/frame-rate.md: low fps while ms GPU stays low)
//     is told with the profiler instead.
//   - Changing a radius recompiles the shader and the fps meter averages, so
//     60 fps shows ~10 s after the second edit. The narration fills that gap.
//   - The preview's counter is off until Display > Show FPS counter on preview
//     is ticked, so the video ticks it.
//   - Measured on the recording machine (an RTX-class GPU, 60Hz display): two
//     radius-20 Compute Blurs at 1024 cost ~17 ms each (Compute Time ~35 ms)
//     and hold the patch at ~28 fps. Radius 8 brings it to ~6 ms and 60 fps.
//     Simulation Quality Half on top of that only takes it to ~5 ms, but Half
//     alone at radius 20 gives ~8 ms and 60 fps, so that's what the narration
//     claims for it. Preview Quality changes nothing here, since the cost is in
//     compute nodes, so the narration says what it is for instead. Blur's own
//     Quality setting made no measurable difference and is left out.
//   - The profiler and the parameter panel both pin to the top right, so the
//     profiler is moved down below the panel: a click meant for a parameter
//     otherwise lands on the profiler.
//   - The desktop app draws through WebView2, so the multi-monitor cap applies
//     to it, but the docs' "try another browser" does not, and chrome://gpu
//     isn't reachable from it. The video keeps to the display-side fixes.
//   - The recording machine has one display, so the cap itself can't be shown.
//     The frame-spacing check from docs/frame-rate.md runs live instead, and a
//     card says what a capped setup prints.

export const title = 'Rhizomium: keeping it smooth live';
export const name = 'rhizomium-performance';

export const lexicon = {
  fps: 'F P S',
  GPU: 'G P U',
  GPUs: 'G P Us',
  'V-Sync': 'vee sync',
  Ctrl: 'control',
  VJ: 'V J',
  Hz: 'hertz',
};

const VIEW = { scale: 0.85, x: 60, y: 470 };
const COL = 220;

const RAMP = [
  // Blurred noise sits near the middle, so the stops crowd in to keep contrast.
  { position: 0.3, color: [0.04, 0.02, 0.12, 1] },
  { position: 0.5, color: [0.13, 0.75, 0.94, 1] },
  { position: 0.7, color: [1.0, 0.3, 0.6, 1] },
];
const n = (id, kind, col, row, params = {}) => ({ id, kind, x: col * COL, y: row * 270, params });
const c = (a, ap, z, zp) => ({ from: { nodeId: a, pin: ap }, to: { nodeId: z, pin: zp } });

// Noise through two wide blurs, coloured by a gradient and displaced by the
// same noise. The blurs are what make it heavy.
const PATCH = {
  nodes: [
    n('1', 'ComputeNoise', 0, 0, { octaves: 6, resolution: '1024', scale: 4, speed: 0.15, colorize: false }),
    n('2', 'ComputeBlur', 1, 0, { radius: 20 }),
    n('3', 'ComputeBlur', 2, 0, { radius: 20 }),
    n('4', 'ComputeGradient', 3, 0, { colorMode: 'Gradient', interpolation: 'Smooth', inputMix: 1, colorStops: RAMP }),
    n('5', 'ComputeWarp', 4, 0, { mode: 'Displace', strength: 0.35 }),
    n('6', 'OutputFinal', 5, 0),
  ],
  connections: [
    c('1', 0, '2', 0), c('2', 0, '3', 0), c('3', 0, '4', 0), c('4', 0, '5', 0),
    c('1', 0, '5', 1), c('5', 0, '6', 0),
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

const STATUS_FPS = '.rz-fps';
const PROFILER = '#compute-profiler-overlay';
const SETTINGS = '#preview-export-settings-window';

/** A dropdown row in Preview / Export Settings, by its label. */
const settingRow = (d, label) => d.page.locator(`${SETTINGS} div`)
  .filter({ has: d.page.locator('label', { hasText: new RegExp(`^${label}:`) }) })
  .last();

/** Pick a dropdown value in Preview / Export Settings, on camera. */
async function pick(d, label, value, note) {
  const row = settingRow(d, label);
  await d.safe(`scroll ${label}`, () => row.scrollIntoViewIfNeeded());
  await d.highlight(row, note ?? label);
  await d.move(row.locator('select'));
  await d.wait(0.4);
  await d.safe(`pick ${label}`, () => row.locator('select').selectOption(value));
  await d.wait(0.5);
}

async function openSettings(d) {
  const open = await d.page.locator(SETTINGS).isVisible().catch(() => false);
  if (!open) await d.menu('View', 'Preview / Export Settings', { hold: 600 });
  await d.wait(0.4);
}

/** Move the profiler below the parameter panel; both pin to the top right. */
const parkProfiler = (d) => d.page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (el) el.style.top = '290px';
}, PROFILER).catch(() => {});

/** Close the profiler on camera, and make sure it went. */
async function closeProfiler(d) {
  await d.closeWindow(PROFILER);
  await d.safe('hide profiler', () => d.page.evaluate(() => window.profilerOverlay?.hide()));
}

/** Type a parameter value on camera, and fall back to setting it if the typing missed. */
async function setRadius(d, nid, value) {
  await d.setParam('Radius', String(value));
  const got = await d.page.evaluate((nid) => window.editor.graph.nodes.find((x) => x.id === nid)?.params?.radius, nid);
  if (Number(got) === value) return;
  d.warnings.push(`[${d.scene?.id}] radius on ${nid} is ${got}, set directly`);
  await d.page.evaluate(([nid, v]) => {
    window.editor.graph.nodes.find((x) => x.id === nid).params.radius = v;
    window.rebuild?.();
  }, [nid, value]);
}

/** Set both blurs' radius off camera, for set-up the viewer needn't watch. */
const setRadii = (d, r) => d.safe('radii', () => d.page.evaluate((r) => {
  for (const x of window.editor.graph.nodes) if (x.kind === 'ComputeBlur') x.params.radius = r;
  window.rebuild?.();
}, r));

const blurs = async (d) => (await d.nodes()).filter((x) => x.kind === 'ComputeBlur').map((x) => x.id);

/**
 * Open a node's parameters. A double-click that lands while a shader is
 * recompiling can arrive as a drag or a title rename, so retry until the
 * panel shows the node (see scenes-midi.mjs).
 */
async function openNode(d, nid) {
  if (!nid) return;
  const home = (await d.nodes()).find((x) => x.id === nid);
  for (let attempt = 0; attempt < 3; attempt++) {
    await d.page.mouse.up().catch(() => {});
    await d.wait(0.3);
    await d.dblclick(await d.body(nid, 60), { settle: 700 });
    const state = await d.page.evaluate((nid) => ({
      open: window.editor.paramPanel?.selectedNode?.id === nid,
      renaming: document.activeElement?.tagName === 'INPUT' && !document.activeElement.closest('#parameter-panel'),
      node: window.editor.graph.nodes.find((x) => x.id === nid),
    }), nid);
    if (state.renaming) await d.key('Escape', 200);
    if (state.node && (state.node.x !== home.x || state.node.y !== home.y)) {
      await d.page.evaluate(([nid, x, y]) => {
        const node = window.editor.graph.nodes.find((m) => m.id === nid);
        node.x = x;
        node.y = y;
        window.editor.markDirty?.('tour-restore');
      }, [nid, home.x, home.y]);
    }
    if (state.open) return;
    d.warnings.push(`[${d.scene?.id}] open ${nid}: retry ${attempt + 1}`);
  }
}

/** The frame-spacing check from docs/frame-rate.md, run in the page. */
const frameSpacing = (d) => d.page.evaluate(() => new Promise((done) => {
  const g = [];
  let last = performance.now();
  const k = (now) => {
    g.push(now - last);
    last = now;
    if (g.length < 200) requestAnimationFrame(k);
    else {
      g.shift();
      const s = g.slice().sort((a, b) => a - b);
      done({ median: s[s.length >> 1], fps: 1000 / (g.reduce((a, b) => a + b, 0) / g.length) });
    }
  };
  requestAnimationFrame(k);
})).catch(() => null);

export default [
  {
    id: 'intro',
    title: 'Keeping it smooth live',
    chapter: false,
    say: `In a live set, a dropped frame is something the whole room sees.
      In this video we'll read the frame-rate numbers, use the Compute Profiler to find what a patch is spending its time on, see why the frame rate follows your display, and go through the settings that win performance back.`,
    async run(d) {
      await d.card(`<h1>Keeping it smooth live</h1><p>Rhizomium <span class="accent">·</span> performance, the profiler, and frame rate</p>`);
      await d.safe('new graph', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
      });
      await d.safe('load patch', () => d.page.evaluate(async (patch) => {
        const { replaceGraphWithPatch } = await import('/src/ai/applyResult.js');
        await replaceGraphWithPatch(patch, { title: 'Keeping it smooth', reason: 'tutorial' });
      }, PATCH));
      await d.wait(0.6);
      await setView(d, VIEW);
      await d.at(1);
      await d.card(`<h1>Keeping it smooth live</h1><ol>
        <li>Reading the frame rate</li><li>The Compute Profiler</li>
        <li>Frame rate vs. display refresh</li><li>Winning performance back</li><li>Before the show</li></ol>`);
      await d.wait(7);
      await d.card('');
    },
  },

  // docs/frame-rate.md - What the number means
  {
    id: 'readouts',
    title: 'Reading the frame rate',
    say: `This patch is struggling, and the first place to look is the bottom right corner.
      The status bar shows how many frames per second the window is actually putting on screen. Hover it for what the number means.
      The preview can show the same count. Open View, Preview Export Settings, and under Display, tick Show FPS counter on preview.
      The count appears in the preview's top left corner. Here it reads under thirty. At sixty frames a second, each frame gets about sixteen point seven milliseconds, so this patch is asking for more work than fits in a frame.`,
    async run(d) {
      await d.at(0, 1.5);
      await d.highlight(STATUS_FPS, 'Frames on screen');
      await d.at(2);
      await d.clearHighlights();
      await d.move(STATUS_FPS);
      await d.wait(1.5);
      // Straight on: under this patch's load the menu takes several seconds.
      await openSettings(d);
      const fpsBox = d.page.locator(`${SETTINGS} label.submenu-toggle`, { hasText: 'Show FPS counter' }).first();
      await d.safe('scroll fps box', () => fpsBox.scrollIntoViewIfNeeded());
      await d.highlight(fpsBox, 'Display');
      await d.click(fpsBox.locator('input'), { settle: 400 });
      await d.clearHighlights();
      await d.closeWindow(SETTINGS);
      await d.at(5);
      await d.highlight('.fps-overlay', 'Under 30');
    },
  },

  // docs/profiler.md - Quick Start, Expanded View, Identifying Issues
  {
    id: 'profiler',
    title: 'The Compute Profiler',
    say: `To find out where that time goes, open View, Compute Profiler, or press Ctrl Alt P.
      It shows the frame rate and frame time, and Compute Time: how long the GPU spent running this patch's compute nodes, measured on the GPU itself.
      Click the plus to expand it. The dispatch breakdown lists every compute node with its own time.
      Most of them cost a fraction of a millisecond. The two Blurs cost around seventeen milliseconds each, so they're the problem.
      A blur's cost grows with its radius. Open the first Blur and bring Radius down from twenty to eight. Then the second.
      Changing a radius rebuilds the shader, so give the numbers a few seconds to settle.
      While we wait, one thing to know: an open profiler times every frame, which costs a little performance of its own.
      Compute Time is now down to a few milliseconds, and the patch is back at sixty frames a second, with a look that's hardly changed.
      Close the profiler when you're done measuring.`,
    async run(d) {
      await d.at(0, 1.2);
      await parkProfiler(d);
      await d.menu('View', 'Compute Profiler', { hold: 600 });
      await parkProfiler(d);
      await d.at(1);
      await d.highlight(PROFILER, 'Compute Profiler');
      await d.at(2);
      await d.clearHighlights();
      await d.click(`${PROFILER} button`, { settle: 600 });
      await d.at(3);
      await d.highlight(PROFILER, 'Dispatch breakdown');
      await d.at(5);
      await d.clearHighlights();
      const [b1, b2] = await blurs(d);
      for (const b of [b1, b2]) if (b) await d.highlight(await d.nodeRect(b, 230), '');
      await d.at(6, 1);
      await d.clearHighlights();
      await d.at(7);
      await openNode(d, b1);
      await setRadius(d, b1, 8);
      await d.at(8);
      await openNode(d, b2);
      await setRadius(d, b2, 8);
      await d.at(11);
      await d.highlight(PROFILER, 'Compute Time');
      await d.at(11, 3.5);
      await d.clearHighlights();
      await d.highlight('.fps-overlay', 'Back to 60');
      await d.at(12);
      await d.clearHighlights();
      await d.at(12, 1);
      await closeProfiler(d);
    },
  },

  // docs/frame-rate.md - Getting the most out of a high-refresh display; Known limitation
  {
    id: 'refresh',
    title: 'Frame rate vs. display refresh',
    say: `There's no fixed target for that number: it follows your display. A sixty hertz monitor reads sixty, a hundred and forty four hertz panel reads a hundred and forty four.
      On a high-refresh display, check the Timing section of Preview Export Settings. V-Sync renders one frame for every refresh of the display. Fixed step renders at the Frame Rate slider instead, so a fixed sixty on a hundred and twenty hertz panel caps your motion at sixty.
      Now, a low frame rate isn't always your patch. With two displays at different refresh rates, the engine Rhizomium draws through can cap every window to one lower rate.
      The giveaway is a low frame rate on a patch the profiler says is light. The GPU is keeping up, and the frames are lost after it.
      To check, measure the spacing between frames. One tight cluster, like every frame at twenty point eight milliseconds, is a hard cap at forty eight hertz. A mix of sixteen and thirty three is real dropped frames.
      The fix is on the display side: set your displays to the same refresh rate, or change which one is the main display. Projectors and TVs often fall back to a twenty four or forty eight hertz film mode, so check those first.`,
    async run(d) {
      await d.at(0, 1);
      await d.highlight(STATUS_FPS, 'Follows your display');
      await d.at(2);
      await d.clearHighlights();
      await openSettings(d);
      await d.at(3);
      await pick(d, 'Timing Mode', 'vsync', 'V-Sync: one frame per refresh');
      await d.at(4);
      await d.clearHighlights();
      const slider = d.page.locator(`${SETTINGS} div`).filter({ hasText: /^Frame Rate/ }).last();
      await d.highlight(slider, 'Fixed step uses this');
      await d.at(5);
      await d.clearHighlights();
      await d.closeWindow(SETTINGS);
      await d.at(6);
      await d.card(`<h1>Two displays, one clock</h1><ul>
        <li>Mixed refresh rates can cap every window</li>
        <li>Low fps <span class="accent">+</span> a light patch in the profiler <span class="accent">=</span> not your patch</li></ul>`);
      await d.at(9);
      const r = await frameSpacing(d);
      await d.at(10);
      const here = r ? `<small>This machine: median ${r.median.toFixed(1)} ms → ${r.fps.toFixed(1)} fps, one display at 60 Hz</small>` : '';
      await d.card(`<h1>Frame spacing</h1><ul>
        <li>Every frame at <code>20.8 ms</code>: a hard cap at 48 Hz</li>
        <li>A mix of <code>16.7</code> and <code>33.3 ms</code>: real dropped frames</li>
        <li>Wide scatter: variable refresh (G-Sync, FreeSync)</li></ul>${here}`);
      await d.at(12);
      await d.card(`<h1>Fix it at the display</h1><ul>
        <li>Same refresh rate on every display</li>
        <li>Or change the main display</li>
        <li>Projectors and TVs: watch for 24 / 48 Hz film modes</li></ul>
        <small>Windows: Settings › System › Display › Advanced display</small>`);
      await d.at(13, 7);
      await d.card('');
    },
  },

  // docs/performance.md - Resolution Settings, Preview Management, Node Performance Guide
  {
    id: 'tips',
    title: 'Winning performance back',
    say: `When the patch itself is the bottleneck, here's where to win the time back.
      Simulation Quality sets the resolution of every compute and feedback texture. Half is a quarter of the pixels. On this patch with both blurs back at radius twenty, Half alone brings it from under thirty frames a second to sixty.
      Sims depend on their resolution, so this changes how the piece looks, which is why it's saved with the project.
      Preview Quality only scales the live preview, and never changes the artwork. It helps when the cost is in the final picture rather than in compute nodes.
      Adaptive quality, under Display, drops the resolution for a moment when frames run over budget, and brings it back when they recover.
      In the graph itself, the expensive nodes are wide blurs, noise with many octaves, Voronoi and big simulations. Lower the radius, octaves or resolution first.
      And every node thumbnail is a small render of its own. Select nodes and press H to hide their previews.`,
    async run(d) {
      await d.at(0, 1);
      await openSettings(d);
      await d.at(1);
      // Both blurs back to radius 20: the heavy patch from the profiler chapter.
      await setRadii(d, 20);
      await d.safe('profiler', () => d.page.evaluate(() => window.profilerOverlay?.show()));
      const sq = settingRow(d, 'Simulation Quality');
      await d.safe('scroll', () => sq.scrollIntoViewIfNeeded());
      await d.highlight(sq, 'Simulation Quality');
      await d.at(2);
      await d.clearHighlights();
      await pick(d, 'Simulation Quality', 'half', 'Half');
      await d.clearHighlights();
      await d.highlight(PROFILER, 'Radius 20, Half');
      await d.at(4, 1.5);
      await d.clearHighlights();
      await d.safe('profiler', () => d.page.evaluate(() => window.profilerOverlay?.hide()));
      await pick(d, 'Simulation Quality', 'full', 'Saved with the project');
      await setRadii(d, 8);
      await d.at(5);
      await d.clearHighlights();
      const pq = settingRow(d, 'Preview Quality');
      await d.safe('scroll', () => pq.scrollIntoViewIfNeeded());
      await d.highlight(pq, 'Machine-local, never the artwork');
      await d.at(7);
      await d.clearHighlights();
      const adaptive = d.page.locator(`${SETTINGS} label.submenu-toggle`, { hasText: 'Adaptive quality' }).first();
      await d.safe('scroll', () => adaptive.scrollIntoViewIfNeeded());
      await d.highlight(adaptive, 'Adaptive quality');
      await d.at(8);
      await d.clearHighlights();
      await d.closeWindow(SETTINGS);
      const noise = await d.node('ComputeNoise');
      const [b1, b2] = await blurs(d);
      for (const id of [noise?.id, b1, b2]) if (id) await d.highlight(await d.nodeRect(id, 230), '');
      await d.at(10);
      await d.clearHighlights();
      await d.at(11);
      if (noise) {
        await d.click(await d.title(noise.id), { settle: 300 });
        await d.key('h', 700);
        await d.highlight(await d.nodeRect(noise.id, 120), 'H: preview hidden');
        await d.wait(2.5);
        await d.clearHighlights();
        await d.key('h', 500);
      }
    },
  },

  // docs/performance.md - Live Performance, System Performance
  {
    id: 'live',
    title: 'Before the show',
    say: `Before a show, rehearse on the machine and the projector you'll actually play on, with the profiler open, and then close it.
      Aim for the display's full rate with headroom to spare, not just barely making it.
      On a laptop, set Rhizomium to High performance in Windows graphics settings, so it runs on the dedicated GPU, and close other apps that use the GPU.
      And keep a lighter version of your heaviest scenes ready, in case the venue's machine can't keep up.`,
    async run(d) {
      await d.at(0, 0.5);
      await d.card(`<h1>Before the show</h1><ul>
        <li>Rehearse on the show machine and projector</li>
        <li>Headroom, not just the display's rate</li>
        <li>Laptops: <code>High performance</code> GPU in Windows graphics settings</li>
        <li>Close other GPU-heavy apps</li>
        <li>A lighter backup of your heaviest scenes</li></ul>`);
      await d.at(3, 4);
      await d.card('');
    },
  },

  {
    id: 'outro',
    title: 'Next steps',
    say: `That's keeping it smooth: read the two numbers, let the profiler point at the expensive node, and fix the display when the patch isn't to blame.
      The full guides are under Help, Documentation: Performance Tips, the Performance Profiler, and Frame Rate and Display Refresh.`,
    async run(d) {
      await d.at(0, 2);
      await d.card(`<h1>Keeping it smooth live</h1><p>Read the numbers <span class="accent">·</span> profile <span class="accent">·</span> fix the display</p>`);
    },
  },
];
