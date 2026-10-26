// How data flows: data types, the four common patterns, and why a connection
// won't take. About four minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-data-flow.mjs --out scripts/tutorial-video/build/03data-flow
//
// Same format as scenes.mjs. It follows docs/guide.md's Understanding Data Flow
// and Common Patterns, corrected against the editor as it is:
//   - The wire colours are the ones src/core/theme.js draws and the status
//     bar's TYPES legend explains, not docs/interface.md's older list.
//   - There is no Blend node; pattern 3 combines its fields with Multiply.
//   - A parameter can't take a wire. Pattern 4 drops the Sin node on the
//     Rotation field, which writes a reference to it (src/ui/NodeReferenceDrop.js).
//   - No wire is ever refused: the type converter (src/codegen/processors/
//     TypeConverter.js) reshapes the value, so a mismatched wire shows up as
//     a black or flat picture, not an error. A loop through ordinary nodes
//     draws nothing (GraphProcessor.js); only compute nodes may feed back.
//
// The pattern graphs are loaded rather than built on camera: this video is
// about reading a graph, and the first-graph video already builds one.

export const title = 'Rhizomium: how data flows';
export const name = 'rhizomium-data-flow';

export const lexicon = {
  UV: 'U V',
  vec2: 'vec two',
  vec3: 'vec three',
  vec4: 'vec four',
  f32: 'F thirty-two',
};

// Graph (0, 0) sits just under the preview window, so every graph lies in the
// free lower band of the screen.
const VIEW = { scale: 1, x: 140, y: 460 };
const BLANK = { x: 1500, y: 280 }; // empty canvas, right of the preview window
const COL = 270;

const RAMP = [
  { position: 0.0, color: [0.16, 0.04, 0.36, 1] },
  { position: 0.5, color: [0.13, 0.88, 0.94, 1] },
  { position: 1.0, color: [1.0, 0.25, 0.62, 1] },
];
const n = (id, kind, col, row, params = {}) => ({ id, kind, x: col * COL, y: row * 270, params });
const c = (a, ap, z, zp) => ({ from: { nodeId: a, pin: ap }, to: { nodeId: z, pin: zp } });
const gradient = (col, row = 0) => n('grad', 'ComputeGradient', col, row, { colorMode: 'Gradient', inputMix: 1, colorStops: RAMP });

const PATTERNS = {
  // UV -> Generator -> Color -> Output
  basic: {
    nodes: [n('uv', 'UV', 0, 0), n('circle', 'Circle', 1, 0, { radius: 0.3, epsilon: 0.3 }), gradient(2), n('out', 'OutputFinal', 3, 0)],
    connections: [c('uv', 0, 'circle', 0), c('circle', 0, 'grad', 0), c('grad', 0, 'out', 0)],
  },
  // UV -> Transform -> Generator -> Color -> Output
  transform: {
    nodes: [n('uv', 'UV', 0, 0), n('rotate', 'Rotate2D', 1, 0, { rotation: 30 }), n('voronoi', 'VoronoiNoise', 2, 0, { scale: 5 }), gradient(3), n('out', 'OutputFinal', 4, 0)],
    connections: [c('uv', 0, 'rotate', 0), c('rotate', 0, 'voronoi', 0), c('voronoi', 0, 'grad', 0), c('grad', 0, 'out', 0)],
  },
  // Two fields combined
  combine: {
    nodes: [
      n('uv', 'UV', 0, 0.5), n('circle', 'Circle', 1, 0, { radius: 0.35, epsilon: 0.2 }), n('noise', 'SimplexNoise', 1, 1),
      n('multiply', 'Multiply', 2, 0.5), gradient(3, 0.5), n('out', 'OutputFinal', 4, 0.5),
    ],
    connections: [c('uv', 0, 'circle', 0), c('uv', 0, 'noise', 0), c('circle', 0, 'multiply', 0), c('noise', 0, 'multiply', 1), c('multiply', 0, 'grad', 0), c('grad', 0, 'out', 0)],
  },
};

/** Set the viewport outright. */
const setView = (d, { scale, x, y }) => d.page.evaluate(([s, x, y]) => {
  const v = window.editor.viewport;
  v.scale = s;
  v.offsetX = x;
  v.offsetY = y;
  window.editor.markDirty?.('tour-view');
}, [scale, x, y]).catch(() => {});

/** Replace the graph with one of PATTERNS, laid out under the preview window. */
async function load(d, key) {
  await d.safe(`load ${key}`, () => d.page.evaluate(async (patch) => {
    const { replaceGraphWithPatch } = await import('/src/ai/applyResult.js');
    await replaceGraphWithPatch(patch, { title: 'How data flows', reason: 'tutorial' });
  }, PATTERNS[key]));
  await d.wait(0.4);
  await setView(d, VIEW);
  await d.wait(1.2);
}

/** The id of the node of this kind (the patterns use one of each). */
const id = async (d, kind) => (await d.node(kind))?.id;

/** Highlight several nodes as one box. */
async function group(d, kinds, label) {
  const rects = [];
  for (const k of kinds) {
    const nid = await id(d, k);
    if (nid) rects.push(await d.nodeRect(nid, 200));
  }
  if (!rects.length) return;
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width)), y1 = Math.max(...rects.map((r) => r.y + r.height));
  await d.highlight({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, label);
}

/** Highlight a pin's type badge: a small box around the pin. */
async function pinBox(d, kind, dir, index, label, width = 90) {
  const nid = await id(d, kind);
  if (!nid) return;
  const p = await d.pin(nid, dir, index);
  const x = dir === 'out' ? p.x - width : p.x - 12;
  await d.highlight({ x, y: p.y - 14, width: width + 12, height: 28 }, label, { pad: 4 });
}

async function closeParams(d) {
  await d.click(BLANK, { settle: 400 });
}

export default [
  {
    id: 'intro',
    title: 'How data flows',
    chapter: false,
    say: `Every Rhizomium graph is a chain of nodes passing data along wires.
      In four minutes: which way the data travels, the kinds of data, the four patterns most graphs use, and why a wire can connect yet show nothing.`,
    async run(d) {
      await d.card(`<h1>How data flows</h1><p>Rhizomium <span class="accent">·</span> types, patterns, and wires that won't take</p>`);
      await d.safe('new graph', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
      });
      await d.wait(1.5);
      await load(d, 'basic');
      await d.at(1, 4);
      await d.card('');
    },
  },

  // docs/guide.md - Understanding Data Flow
  {
    id: 'left-to-right',
    title: 'Left to right',
    say: `Data flows from left to right.
      Each node takes its inputs on the left edge, does one job, and passes the result out of its right edge.
      On the far left are input nodes, like UV and Time, which make data out of nothing: the position of each pixel, or the clock.
      In the middle, processing nodes reshape it: shapes, maths, noise and colour.
      And on the far right, the Output node sends the final colour to the screen.
      Read any graph the same way: start at the Output and follow the wires back.`,
    async run(d) {
      await d.at(1);
      const circle = await id(d, 'Circle');
      if (circle) {
        await d.highlight({ ...(await d.pin(circle, 'in', 0)), width: 1, height: 1 }, 'In', { pad: 14 });
        await d.highlight({ ...(await d.pin(circle, 'out', 0)), width: 1, height: 1 }, 'Out', { pad: 14 });
      }
      await d.at(2);
      await d.clearHighlights();
      await group(d, ['UV'], 'Input');
      await d.at(3);
      await d.clearHighlights();
      await group(d, ['Circle', 'ComputeGradient'], 'Processing');
      await d.at(4);
      await d.clearHighlights();
      await group(d, ['OutputFinal'], 'Output');
      await d.at(5);
      await d.clearHighlights();
      for (const k of ['OutputFinal', 'ComputeGradient', 'Circle', 'UV']) {
        const nid = await id(d, k);
        if (nid) await d.move(await d.title(nid), 700);
        await d.wait(0.3);
      }
    },
  },

  // docs/guide.md - Data Types; src/ui/StatusBar.js TYPE_LEGEND
  {
    id: 'types',
    title: 'Data types',
    say: `Every pin carries one kind of data, and its badge tells you which.
      UV's output says vec2: two numbers, an x and a y position.
      The Circle's output says f32, a single number for each pixel: one inside the circle, zero outside.
      The Gradient's output says tex, a texture: a whole finished image.
      Colours travel as vec4: red, green, blue and alpha, and vec3 holds three numbers.
      The wire takes the colour of what it carries.
      Hover TYPES in the status bar at the bottom for the key: amber for a single number, violet for vectors, teal for colour, and cyan for textures.`,
    async run(d) {
      await d.at(1);
      await pinBox(d, 'UV', 'out', 0, 'vec2', 100);
      await d.at(2);
      await d.clearHighlights();
      await pinBox(d, 'Circle', 'out', 0, 'f32', 50);
      await d.at(3);
      await d.clearHighlights();
      await pinBox(d, 'ComputeGradient', 'out', 0, 'tex', 50);
      await d.at(4);
      await d.clearHighlights();
      await pinBox(d, 'OutputFinal', 'in', 0, 'color', 60);
      await d.at(5);
      await d.clearHighlights();
      await d.at(6);
      await d.safe('hover legend', () => d.move('.rz-sb-legend-btn'));
      await d.wait(0.8);
      await d.highlight('#rz-sb-legend-tip', 'Wire colours');
      await d.wait(5);
      await d.clearHighlights();
      await d.move(BLANK);
    },
  },

  // docs/guide.md - Common Patterns 1-3
  {
    id: 'patterns',
    title: 'Three common patterns',
    say: `Most graphs are built from a few patterns.
      The first is the one you've just seen: coordinates, a generator that makes a shape or a pattern, a colour step, and the Output.
      The second puts a transform in front of the generator.
      Here, Rotate 2D turns the coordinates before Voronoi Noise reads them, so the whole pattern turns with it.
      Transforms change where things are drawn, not what's drawn.
      The third combines two fields.
      One UV feeds both a Circle and a Simplex Noise, since an output can drive as many inputs as you like, and a Multiply keeps the noise only inside the circle.`,
    async run(d) {
      await d.at(1);
      await group(d, ['UV', 'Circle', 'ComputeGradient', 'OutputFinal'], 'UV → Generator → Color → Output');
      await d.at(2);
      await d.clearHighlights();
      await load(d, 'transform');
      await d.at(3);
      await group(d, ['Rotate2D'], 'Transform');
      await d.at(4);
      await d.clearHighlights();
      await group(d, ['VoronoiNoise'], 'Generator');
      await d.at(5);
      await d.clearHighlights();
      await load(d, 'combine');
      await d.at(6);
      await group(d, ['Circle', 'SimplexNoise'], 'Two fields');
      await d.wait(2.5);
      await d.clearHighlights();
      await group(d, ['Multiply'], 'Combined');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/guide.md - Common Patterns 4: Animated Parameters
  {
    id: 'animate',
    title: 'Animating a parameter',
    say: `The fourth pattern animates a parameter.
      Back on the transform graph, add a Time node and a Sin node, and wire Time into the Sin.
      Parameters don't take wires, so instead, open Rotate 2D, and drag the Sin node itself onto the Rotation field.
      That writes a reference to the Sin node into the field.
      Rotation is in degrees and a sine only swings between minus one and one, so add times 45 to the end of the reference: now the pattern rocks 45 degrees each way.
      Typing an expression, like equals sine of time times 45, does the same job without the extra nodes.`,
    async run(d) {
      await load(d, 'transform');
      await d.at(1);
      const time = await d.addNode('time', await d.world(0, 270));
      const sin = await d.addNode('sin', await d.world(COL, 270));
      await d.wire(time, 0, sin, 0);
      await d.at(2);
      const rotate = await id(d, 'Rotate2D');
      await d.openParams(rotate);
      await d.wait(0.5);
      await d.safe('drop Sin on Rotation', async () => {
        const field = d.paramField('Rotation');
        await field.waitFor({ state: 'visible', timeout: 4000 });
        const from = await d.title(sin);
        const to = await d.point(field);
        await d.drag(from, to, { ms: 1400 });
      });
      await d.at(3);
      await d.highlight(d.paramBlock('Rotation'), 'Reference to Sin');
      await d.at(4);
      await d.clearHighlights();
      await d.safe('scale the reference', async () => {
        await d.click(d.paramField('Rotation'), { settle: 200 });
        await d.page.keyboard.press('End');
        await d.type(' * 45', { delay: 110 });
        await d.key('Enter', 600);
      });
      await d.wait(1);
      await d.highlight('.floating-gpu-preview', 'Rocking');
      await d.wait(4);
      await d.clearHighlights();
      await closeParams(d);
    },
  },

  // docs/guide.md - Troubleshooting; TypeConverter.js, GraphProcessor.js
  {
    id: 'wont-take',
    title: "When a connection won't take",
    say: `Sometimes a wire connects but nothing shows up, and there are three usual reasons.
      First, the drop missed the pin: let go anywhere but on an input pin, and the wire simply disappears, so aim for the dot.
      Second, the types don't fit.
      Rhizomium never refuses a wire; it converts the data to what the input expects, but the result may mean nothing.
      Wire Time into the Circle's UV input, and every pixel gets the same position, so the whole frame turns one flat colour.
      The badges show why: a single number, where coordinates belong.
      Wire the UV back in, and the picture returns.
      Third, a loop: a node can't use its own result in the same frame, so a wire back into an earlier node leaves everything after it blank, and feedback effects need a compute node made for it, like Compute Feedback.`,
    async run(d) {
      await load(d, 'basic');
      const uv = await id(d, 'UV'), circle = await id(d, 'Circle');
      const time = await d.addNode('time', await d.world(0, 270));
      await d.at(1);
      if (time && circle) {
        // Released 70 px short of the Circle's UV pin: the wire is dropped.
        const target = await d.pin(circle, 'in', 0);
        await d.drag(await d.pin(time, 'out', 0), { x: target.x - 70, y: target.y + 40 }, { ms: 1000 });
        await d.wait(0.8);
        await d.highlight({ ...target, width: 1, height: 1 }, 'Aim here', { pad: 14 });
        await d.wait(2.5);
        await d.clearHighlights();
      }
      await d.at(4);
      await d.wire(time, 0, circle, 0);
      await d.wait(1);
      await d.highlight('.floating-gpu-preview', 'One flat colour');
      await d.at(5);
      await d.clearHighlights();
      await pinBox(d, 'Time', 'out', 0, 'f32', 50);
      await pinBox(d, 'Circle', 'in', 0, 'wants vec2', 40);
      await d.at(6);
      await d.clearHighlights();
      await d.wire(uv, 0, circle, 0);
      await d.wait(1);
      await d.highlight('.floating-gpu-preview', 'Back');
      await d.at(7);
      await d.clearHighlights();
    },
  },

  {
    id: 'outro',
    title: 'Next steps',
    say: `So: data flows left to right, every pin has a type you can read from its badge and its wire colour, and most graphs are one of four patterns, or a few of them joined together.
      When the picture goes blank or flat, check that the drop landed, that the types fit, and that no wire loops back.
      The Node Reference lists every node with the types of its pins.`,
    async run(d) {
      await d.at(2);
      await d.card(`<h1>Left to right</h1><p>Next <span class="accent">·</span> the Node Reference</p>`);
    },
  },
];
