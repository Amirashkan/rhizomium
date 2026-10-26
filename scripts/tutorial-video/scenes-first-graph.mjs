// Your first graph: from an empty canvas to an animated, coloured pattern in
// eight nodes. Five to seven minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-first-graph.mjs --out scripts/tutorial-video/build/02first-graph
//
// Same format as scenes.mjs. It follows docs/guide.md's path, UV -> Circle ->
// Time -> Gradient -> Output, with the nodes the editor has today: Color Ramp
// is gone (the Gradient node's Value input and colour stops replaced it), and a
// parameter can't take a wire, so Time joins the Circle through Multiply and Add.
// The Gradient reads its input from an 8-bit texture, which clips anything
// above 1; a Fract wraps the sum so the colours cycle instead of saturating.

export const title = 'Rhizomium: your first graph';
export const name = 'rhizomium-first-graph';

export const lexicon = {
  UV: 'U V',
};

// Where each node goes, in graph units. The view below puts graph (0, 0) just
// under the preview window, so the whole graph sits in the free lower band.
const AT = {
  uv: [0, 0], circle: [270, 0],
  time: [0, 270], multiply: [270, 270],
  add: [560, 120], fract: [830, 120], gradient: [1100, 120], output: [1370, 120],
};
const VIEW = { scale: 1, x: 140, y: 460 };

const BLANK = { x: 1500, y: 280 }; // empty canvas, right of the preview window
const N = {}; // node ids, filled in as the scenes place them

/** Set the viewport outright: used once, while the canvas is empty. */
const setView = (d, { scale, x, y }) => d.page.evaluate(([s, x, y]) => {
  const v = window.editor.viewport;
  v.scale = s;
  v.offsetX = x;
  v.offsetY = y;
  window.editor.markDirty?.('tour-view');
}, [scale, x, y]).catch(() => {});

async function place(d, key, query, opts) {
  const [x, y] = AT[key];
  N[key] = await d.addNode(query, await d.world(x, y), opts);
  return N[key];
}

async function closeParams(d) {
  await d.click(BLANK, { settle: 400 });
}

/** Pick an option in a parameter's dropdown. */
async function choose(d, label, value) {
  return d.safe(`choose ${label}`, async () => {
    const sel = d.paramBlock(label).locator('select').first();
    await sel.scrollIntoViewIfNeeded();
    await d.move(sel);
    await d.wait(0.3);
    await sel.selectOption(value);
    await d.wait(0.6);
  });
}

/** The i-th colour stop's row in the open Gradient panel. */
const stopRow = (d, i) => d.page.locator('.parameter-panel .color-stop-item').nth(i);

/** Set a colour stop's colour; the cursor points at its swatch. */
async function stopColor(d, i, hex) {
  return d.safe(`stop ${i} colour`, async () => {
    const swatch = stopRow(d, i).locator('input[type="color"]');
    await swatch.scrollIntoViewIfNeeded();
    await d.move(swatch);
    await d.wait(0.3);
    await swatch.fill(hex);
    await d.wait(0.7);
  });
}

export default [
  {
    id: 'intro',
    title: 'Your first graph',
    chapter: false,
    say: `In this video we'll build your first graph in Rhizomium, starting from an empty canvas.
      By the end you'll have an animated pattern of coloured rings, flowing out from the centre of the screen.
      It takes eight nodes, and along the way you'll learn how to add nodes, wire them together, change their parameters, and get the result on screen.`,
    async run(d) {
      await d.card(`<h1>Your first graph</h1><p>Rhizomium <span class="accent">·</span> UV → Circle → Time → Gradient → Output</p>`);
      await d.at(2, 2);
      await d.card('');
    },
  },

  // docs/guide.md - Understanding the Node Editor, Basic Controls
  {
    id: 'empty-canvas',
    title: 'An empty canvas',
    say: `When the editor opens, click Start New Graph.
      It gives you a small example graph, which we'll clear away.
      Hold the right mouse button and drag a box around every node, then press Delete.
      Now the canvas is empty.
      You can pan it by dragging with the middle mouse button, and zoom with the scroll wheel.
      The preview window, top left, shows whatever reaches the Output node, and right now that's nothing.`,
    async run(d) {
      await d.click(d.page.getByText('Start New Graph').first(), { settle: 1200 });
      await d.wait(1.2);
      await d.at(1);
      const nodes = await d.nodes();
      if (nodes.length) {
        await d.at(2);
        const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
        // Start the box below-right of the graph: the preview window covers its top left.
        const br = await d.world(Math.max(...nodes.map((n) => n.x + (n.w || 180))) + 60, Math.max(...ys) + 280);
        const tl = await d.world(Math.min(...xs) - 60, Math.min(...ys) - 60);
        await d.safe('box select', async () => {
          await d.move(br);
          await d.page.mouse.down({ button: 'right' });
          await d.move({ x: Math.max(tl.x, 680), y: Math.max(tl.y, 120) }, 1100);
          await d.page.mouse.up({ button: 'right' });
        });
        await d.wait(0.5);
        // A box that missed a node still leaves the canvas clean for the rest.
        await d.page.evaluate(() => window.editor.selection?.selectAll?.()).catch(() => {});
        await d.key('Delete', 800);
      }
      await d.at(3);
      await setView(d, VIEW);
      await d.at(4);
      await d.pan(-200, -100, { x: 1300, y: 760 });
      await d.pan(200, 100, { x: 1100, y: 660 });
      await d.zoom({ x: 1200, y: 700 }, 2);
      await d.wait(0.4);
      await d.zoom({ x: 1200, y: 700 }, -2);
      await setView(d, VIEW);
      await d.at(5);
      await d.highlight('.floating-gpu-preview', 'Preview');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/guide.md - Step 1: Create UV Coordinates
  {
    id: 'uv',
    title: 'UV coordinates',
    say: `Every visual starts with coordinates: a way for each pixel to know where it is.
      Right-click the canvas to open the Add Node palette.
      You can browse the categories down the side, but typing is quicker: type U V, and press Enter.
      The UV node gives every pixel its position, from zero to one across the frame and from zero to one down it.
      Its thumbnail shows those two numbers as red and green: black in the bottom left corner, red growing to the right, green growing upwards, and yellow in the top right, where both are high.
      Every node has a thumbnail like this, so you can see what each step of the graph is doing.`,
    async run(d) {
      await d.at(1);
      const [x, y] = AT.uv;
      const where = await d.world(x, y);
      await d.rightClick(where, { settle: 700 });
      await d.highlight('.rz-palette', 'Add Node');
      await d.at(2);
      await d.clearHighlights();
      await d.type('uv', { delay: 150 });
      await d.wait(0.6);
      const before = new Set((await d.nodes()).map((n) => n.id));
      await d.key('Enter', 700);
      N.uv = (await d.nodes()).find((n) => !before.has(n.id))?.id;
      await d.at(3);
      if (N.uv) await d.highlight(await d.nodeRect(N.uv, 200), 'UV');
      await d.at(5);
      await d.clearHighlights();
    },
  },

  // docs/guide.md - Step 2: Add a Circle Field, Step 3: Connect UV to Circle
  {
    id: 'circle',
    title: 'A circle',
    say: `Next, a shape.
      Right-click beside the UV node, type circle, and place a Circle.
      To connect them, drag from the UV's output pin on its right edge to the Circle's input pin on its left.
      The wire tells the Circle which coordinates to draw with, and its thumbnail shows a white disc in the middle of the frame.
      Double-click the Circle to open its parameters, in the panel at the top right. Drag its bottom corner down to make it taller, and it stays that size for every node.
      Set the Radius to 0.3, and the Softness to 0.3.
      Softness blurs the edge, so instead of a hard disc we get a glow that fades from white in the centre to black at the rim.
      That fade is what we'll turn into rings of colour.
      Click empty canvas to close the panel.`,
    async run(d) {
      await d.at(1);
      await place(d, 'circle', 'circle');
      await d.at(2);
      await d.wire(N.uv, 0, N.circle, 0);
      await d.at(3);
      if (N.circle) await d.highlight(await d.nodeRect(N.circle, 200), 'Circle');
      await d.at(4);
      await d.clearHighlights();
      await d.openParams(N.circle);
      await d.safe('resize panel', async () => {
        const grip = await d.point('.parameter-panel .parameter-panel__resize-handle');
        await d.drag(grip, { x: grip.x, y: 470 });
      });
      await d.at(6);
      await d.setParam('Radius', '0.3');
      await d.safe('scroll to Softness', () => d.paramBlock('Softness').scrollIntoViewIfNeeded());
      await d.setParam('Softness', '0.3');
      await d.at(7);
      if (N.circle) await d.highlight(await d.nodeRect(N.circle, 200), 'Soft edge');
      await d.at(9);
      await d.clearHighlights();
      await closeParams(d);
    },
  },

  // docs/guide.md - Step 4: Add Animation with Time, Step 5: Modulate the Circle
  {
    id: 'time',
    title: 'Adding time',
    say: `Now let's make it move.
      Below the UV, add a Time node.
      Time is a clock: it outputs the number of seconds the editor has been running, so it climbs steadily, one every second.
      That's too fast for us, so add a Multiply node, and wire Time into its first input.
      Open the Multiply and set B to 0.2. That's our speed control: the time now goes up by a fifth every second.
      Next, add an Add node.
      Wire the Circle into its first input, and the slowed-down time into its second.
      Every pixel's brightness now keeps rising, but a pixel can't get brighter than white, so on its own this would just fade to white.
      The fix is a Fract node, which keeps only the part of a number after the decimal point.
      So 1.25 becomes 0.25, and as the value keeps climbing it wraps from one back to zero, over and over.
      Wire the Add into the Fract, and look at its thumbnail: grey rings, flowing outwards.`,
    async run(d) {
      await d.at(1);
      await place(d, 'time', 'time');
      await d.at(3);
      await place(d, 'multiply', 'multiply');
      await d.wire(N.time, 0, N.multiply, 0);
      await d.at(4);
      await d.openParams(N.multiply);
      await d.setParam('B', '0.2');
      await closeParams(d);
      await d.at(6);
      await place(d, 'add', 'add');
      await d.at(7);
      await d.wire(N.circle, 0, N.add, 0);
      await d.wire(N.multiply, 0, N.add, 1);
      await d.at(9);
      await place(d, 'fract', 'fract');
      await d.at(11);
      await d.wire(N.add, 0, N.fract, 0);
      if (N.fract) await d.highlight(await d.nodeRect(N.fract, 200), 'Rings');
      await d.wait(4);
      await d.clearHighlights();
    },
  },

  // docs/guide.md - Step 6: Add Color
  {
    id: 'gradient',
    title: 'Colour with a Gradient',
    say: `Grey is a start, but we want colour.
      Add a Gradient node, and wire the Fract into its Value input.
      The Gradient turns each brightness into a colour: dark values take the colour at its left end, bright values the colour at its right.
      Double-click it, and set the Color Mode to Gradient, so it uses colour stops you choose.
      There are two stops to begin with, black at position zero and white at one.
      Click a stop's swatch to pick its colour: make the first one a deep purple, and the second a hot pink.
      Then click the middle of the bar above the stops to add a third one there, at 0.5, and make it cyan.
      The bar at the top shows the whole ramp, purple through cyan to pink.`,
    async run(d) {
      await d.at(1);
      await place(d, 'gradient', 'gradient');
      await d.wire(N.fract, 0, N.gradient, 0);
      await d.at(2);
      if (N.gradient) await d.highlight(await d.nodeRect(N.gradient, 200), 'Gradient');
      await d.at(3);
      await d.clearHighlights();
      await d.openParams(N.gradient);
      await choose(d, 'ColorMode', 'Gradient');
      await d.at(4);
      await d.safe('show stops', () => d.page.locator('.parameter-panel .color-stops-widget').first().scrollIntoViewIfNeeded());
      await d.highlight('.parameter-panel .color-stop-list', 'Stops');
      await d.at(5);
      await d.clearHighlights();
      await stopColor(d, 0, '#2a0b5c');
      await stopColor(d, 1, '#ff3f9e');
      await d.at(6);
      // Clicking the bar inserts the stop in position order; Add Stop appends it
      // out of order, and the ramp then skips the colour.
      await d.click('.parameter-panel .gradient-preview', { settle: 600 });
      await stopColor(d, 1, '#22e0f0');
      await d.at(7);
      await d.highlight('.parameter-panel .gradient-preview', 'Purple · cyan · pink');
      await d.wait(3);
      await d.clearHighlights();
      await closeParams(d);
    },
  },

  // docs/guide.md - Step 7: Output Your Visual
  {
    id: 'output',
    title: 'Out to the screen',
    say: `The last step is the one that puts it on screen.
      Add an Output node, and wire the Gradient into it.
      The preview window lights up: coloured rings, flowing outwards from the centre, forever.
      The Output is the end of every graph. Only what reaches it is drawn, in the preview, on a second screen, or in an exported video.
      Click the fullscreen button on the preview to see it at full size, and click it again to come back.`,
    async run(d) {
      await d.at(1);
      await place(d, 'output', 'output');
      await d.wire(N.gradient, 0, N.output, 0);
      await d.at(2);
      await d.highlight('.floating-gpu-preview', 'Live');
      await d.at(3);
      await d.clearHighlights();
      await d.at(5);
      await d.click('.floating-gpu-preview .btn-fullscreen', { settle: 4500 });
      await d.click('.floating-gpu-preview .btn-fullscreen', { settle: 500 });
      await d.page.evaluate(() => {
        const p = window.floatingPreview;
        if (p?.isFullscreen) p.toggleFullscreen();
      }).catch(() => {});
    },
  },

  // docs/guide.md - Experiment and Explore, Understanding Data Flow
  {
    id: 'tweak',
    title: 'Make it yours',
    say: `Now that it runs, every number in the graph is yours to change, and the preview updates as you type.
      Open the Multiply again and set B to minus 0.5: the rings now flow inwards, and faster.
      Open the Gradient and set Repeat to 3, and the ramp of colours runs three times across the glow, for thinner rings.
      Or open the Circle and raise its Radius to 0.45, and the glow, and the rings with it, spread across more of the frame.
      Notice how the data flows from left to right: coordinates and time on the left, shapes and maths in the middle, colour, and finally the Output.
      Almost every graph you build will have that same shape.`,
    async run(d) {
      await d.at(1);
      await d.openParams(N.multiply);
      await d.setParam('B', '-0.5');
      await closeParams(d);
      await d.at(2);
      await d.openParams(N.gradient);
      await d.safe('scroll to Repeat', () => d.paramBlock('Repeat').scrollIntoViewIfNeeded());
      await d.setParam('Repeat', '3');
      await closeParams(d);
      await d.at(3);
      await d.openParams(N.circle);
      await d.setParam('Radius', '0.45');
      await closeParams(d);
      await d.at(4);
      const ids = [N.uv, N.time, N.circle, N.multiply, N.add, N.fract, N.gradient, N.output];
      for (const id of ids) {
        if (!id) continue;
        await d.highlight(await d.nodeRect(id, 200));
        await d.wait(0.55);
      }
      await d.at(5);
      await d.clearHighlights();
    },
  },

  // docs/guide.md - Tips and Tricks, Next Steps
  {
    id: 'outro',
    title: 'Next steps',
    say: `That's your first graph: UV, a Circle, Time, a Gradient, and the Output.
      Save it with Control S, and if you change something you don't like, Control Z undoes it.
      From here, try swapping the Circle for a Voronoi or a Noise node, and see what the same chain of colour and time does to it.
      The Node Reference lists every node in the editor, and the Audio Reactivity guide shows how to make a graph like this one move to music.`,
    async run(d) {
      await d.at(3);
      await d.card(`<h1>You built your first graph</h1><p>Next <span class="accent">·</span> Node Reference · Audio Reactivity</p>`);
    },
  },
];
