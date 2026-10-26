// Keyboard shortcuts: the keys worth learning first. About two minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-shortcuts.mjs --out scripts/tutorial-video/build/05shortcuts
//
// Same format as scenes.mjs. Follows docs/shortcuts.md, keeping to keys that
// were checked against the editor (src/ui/shortcuts.js, main.js):
//   - F frames the selection only; with nothing selected it reports "Select
//     nodes to frame", so the video selects first.
//   - The arrow-key step is the grid size when snapping is on, so the narration
//     says "further" rather than a number of pixels.
//   - Ctrl+A is not bound and is left out.
//   - Paste reads the system clipboard first; the recording's browser would sit
//     on a permission prompt the screencast can't show, so the scene grants it.
//
// Each key pressed on camera is shown as keycaps at the bottom of the frame.

export const title = 'Rhizomium: keyboard shortcuts';
export const name = 'rhizomium-shortcuts';

export const lexicon = {
  F2: 'F two',
};

const VIEW = { scale: 1, x: 140, y: 380 }; // the starter graph, clear of the preview window
const BLANK = { x: 1500, y: 280 };

/** Set the viewport outright. */
const setView = (d, { scale, x, y }) => d.page.evaluate(([s, x, y]) => {
  const v = window.editor.viewport;
  v.scale = s;
  v.offsetX = x;
  v.offsetY = y;
  window.editor.markDirty?.('tour-view');
}, [scale, x, y]).catch(() => {});

/** Show `combo` (e.g. "Ctrl+D") as keycaps at the bottom of the frame until replaced. */
const caps = (d, combo) => d.page.evaluate((combo) => {
  const layer = document.getElementById('tour-layer') || document.body;
  let el = document.getElementById('tour-keys');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tour-keys';
    el.style.cssText = `position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%);
      display: flex; gap: 10px; align-items: center; transition: opacity 250ms; opacity: 0;
      font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif;`;
    layer.appendChild(el);
  }
  el.replaceChildren();
  if (!combo) { el.style.opacity = '0'; return; }
  combo.split('+').forEach((k, i) => {
    if (i) {
      const plus = document.createElement('span');
      plus.textContent = '+';
      plus.style.cssText = 'color: #c6f04a; font-size: 30px; font-weight: 600;';
      el.appendChild(plus);
    }
    const cap = document.createElement('span');
    cap.textContent = k;
    cap.style.cssText = `min-width: 44px; padding: 10px 18px; text-align: center; border-radius: 10px;
      background: rgba(20,19,17,.94); color: #f3f1ea; font-size: 30px; font-weight: 600;
      border: 2px solid #c6f04a; box-shadow: 0 6px 0 #6f8a24, 0 10px 30px rgba(0,0,0,.5);`;
    el.appendChild(cap);
  });
  el.style.opacity = '1';
}, combo).catch(() => {});

/** Show the keycaps, then press the keys for real. */
async function press(d, combo, settle = 700) {
  await caps(d, combo.label || combo);
  await d.wait(0.35);
  await d.key(combo.keys || combo.replace('Ctrl', 'Control'), settle);
}

const sel = (d) => d.page.evaluate(() => [...(window.editor.selection?.getSelected?.() || [])]);

export default [
  {
    id: 'intro',
    title: 'Keyboard shortcuts',
    chapter: false,
    say: `Rhizomium gets a lot quicker with a few keys under your fingers.
      Here are the ones worth learning first. On a Mac, use Command wherever you hear Control.`,
    async run(d) {
      await d.card(`<h1>Keyboard shortcuts</h1><p>Rhizomium <span class="accent">·</span> the keys worth learning first</p>`);
      await d.safe('new graph', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
      });
      await d.wait(1.5);
      await setView(d, VIEW);
      // Paste reads the system clipboard; grant it so no prompt stalls it.
      await d.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(d.page.url()).origin }).catch(() => {});
      await d.at(1, 3);
      await d.card('');
    },
  },

  // docs/shortcuts.md - intro, Help
  {
    id: 'keymap',
    title: 'Finding any key',
    say: `You never have to memorise them all: every menu command prints its key right beside it.
      And Control slash opens the whole keymap, with a filter box. Type a word, like duplicate, to find its key.
      Escape closes it.`,
    async run(d) {
      await d.menu('Edit');
      await d.highlight('#dropdown-edit', 'Keys beside every command');
      await d.at(1);
      await d.clearHighlights();
      await d.closeMenus();
      await press(d, { label: 'Ctrl+/', keys: 'Control+/' }, 900);
      await caps(d, '');
      await d.at(2);
      await d.safe('filter', async () => {
        await d.click(d.page.locator('.keymap-overlay input').first(), { settle: 200 });
        await d.type('duplicate', { delay: 110 });
      });
      await d.at(3);
      await press(d, 'Escape');
      await caps(d, '');
    },
  },

  // docs/shortcuts.md - Node, Edit
  {
    id: 'nodes',
    title: 'Nodes',
    say: `Control Space opens the Add Node palette in the middle of the canvas, without reaching for the mouse.
      Select a node and press Control D to duplicate it.
      Control C and Control V copy and paste, and the wires between the copied nodes come along too.
      Delete removes the selection.
      And Control Z undoes any of it, while Control Y redoes.`,
    async run(d) {
      await press(d, 'Ctrl+Space', 800);
      await d.type('circle', { delay: 110 });
      await d.wait(0.5);
      const before = new Set((await d.nodes()).map((n) => n.id));
      await d.key('Enter', 800);
      const circle = (await d.nodes()).find((n) => !before.has(n.id))?.id;
      await caps(d, '');
      // The palette drops it mid-canvas, among the starter nodes; move it clear.
      if (circle) await d.drag(await d.title(circle), await d.world(560, 470), { ms: 800 });
      await d.at(1);
      if (circle) await d.click(await d.title(circle), { settle: 300 });
      await press(d, 'Ctrl+D', 900);
      await caps(d, '');
      await d.at(2);
      // The starter's Noise and Gradient, boxed with a right-drag.
      const ns = (await d.nodes()).filter((n) => ['ComputeNoise', 'ComputeGradient'].includes(n.kind));
      if (ns.length) {
        const tl = await d.world(Math.min(...ns.map((n) => n.x)) - 40, Math.min(...ns.map((n) => n.y)) - 40);
        const br = await d.world(Math.max(...ns.map((n) => n.x + (n.w || 180))) + 40, Math.max(...ns.map((n) => n.y)) + 230);
        await d.safe('box select', async () => {
          await d.move(br);
          await d.page.mouse.down({ button: 'right' });
          await d.move(tl, 900);
          await d.page.mouse.up({ button: 'right' });
        });
      }
      await press(d, 'Ctrl+C', 500);
      await d.move({ x: 1000, y: 880 }, 700);
      await press(d, 'Ctrl+V', 1200);
      await caps(d, '');
      await d.at(3);
      await press(d, 'Delete', 900);
      await d.at(4);
      await press(d, 'Ctrl+Z', 1100);
      await press(d, 'Ctrl+Y', 1100);
      await caps(d, '');
    },
  },

  // docs/shortcuts.md - Canvas, Node Movement, Edit (F2), View (zoom)
  {
    id: 'canvas',
    title: 'Canvas and selection',
    say: `With a node selected, the arrow keys nudge it, and holding Shift moves it further.
      F frames the selection, filling the view with it.
      H hides or shows the thumbnails of the selected nodes.
      F2 renames the selected node: type the name and press Enter.
      Control equals and Control minus zoom in and out, and Control zero puts the zoom back to a hundred percent.`,
    async run(d) {
      const grad = (await d.nodes()).find((n) => n.kind === 'ComputeGradient');
      if (grad) await d.click(await d.title(grad.id), { settle: 300 });
      for (let i = 0; i < 3; i++) await press(d, { label: '→', keys: 'ArrowRight' }, 250);
      await press(d, { label: 'Shift+→', keys: 'Shift+ArrowRight' }, 500);
      await press(d, { label: 'Shift+←', keys: 'Shift+ArrowLeft' }, 500);
      await caps(d, '');
      await d.at(1);
      await press(d, { label: 'F', keys: 'f' }, 1800);
      await caps(d, '');
      await d.at(2);
      await setView(d, VIEW);
      await d.wait(0.3);
      if (grad) await d.click(await d.title(grad.id), { settle: 300 });
      await press(d, { label: 'H', keys: 'h' }, 1200);
      await press(d, { label: 'H', keys: 'h' }, 600);
      await caps(d, '');
      await d.at(3);
      await press(d, 'F2', 500);
      await d.type('Clouds', { delay: 120 });
      await d.key('Enter', 600);
      await caps(d, '');
      await d.at(4);
      await press(d, { label: 'Ctrl+=', keys: 'Control+=' }, 400);
      await press(d, { label: 'Ctrl+=', keys: 'Control+=' }, 400);
      await press(d, { label: 'Ctrl+-', keys: 'Control+-' }, 600);
      await press(d, 'Ctrl+0', 900);
      await caps(d, '');
    },
  },

  // docs/shortcuts.md - View, Window
  {
    id: 'layouts',
    title: 'Panels and layouts',
    say: `A few panels have keys of their own.
      Control backtick shows the WGSL shader your graph compiles to.
      Control Alt T opens the timeline, for keyframes.
      Control Alt 3 switches to the Minimal layout, nothing but the graph, and Control Alt 0 puts every panel back where it started.`,
    async run(d) {
      await d.click(BLANK, { settle: 300 });
      await d.at(1);
      await press(d, { label: 'Ctrl+`', keys: 'Control+`' }, 2200);
      await press(d, { label: 'Ctrl+`', keys: 'Control+`' }, 500);
      await caps(d, '');
      await d.at(2);
      await press(d, { label: 'Ctrl+Alt+T', keys: 'Control+Alt+t' }, 2200);
      await press(d, { label: 'Ctrl+Alt+T', keys: 'Control+Alt+t' }, 500);
      await caps(d, '');
      await d.at(3);
      await press(d, { label: 'Ctrl+Alt+3', keys: 'Control+Alt+3' }, 2500);
      await press(d, { label: 'Ctrl+Alt+0', keys: 'Control+Alt+0' }, 1500);
      await caps(d, '');
    },
  },

  // docs/shortcuts.md - View, Canvas, File
  {
    id: 'panels',
    title: 'Preview, Escape and Save',
    say: `Control 2 hides and shows the preview window, when you need the room.
      Escape closes menus and panels, and cancels a wire you're dragging.
      And Control S saves: press it often.`,
    async run(d) {
      await press(d, 'Ctrl+2', 1500);
      await press(d, 'Ctrl+2', 600);
      await caps(d, '');
      await d.at(1);
      await d.menu('View');
      await press(d, 'Escape', 600);
      await d.closeMenus();
      await caps(d, '');
      await d.at(2);
      // Shown, not pressed: in the browser build it opens a system dialog.
      await caps(d, 'Ctrl+S');
      await d.wait(2.5);
      await caps(d, '');
    },
  },

  {
    id: 'outro',
    title: 'Next steps',
    say: `That's the core set. Whenever you forget one, press Control slash.`,
    async run(d) {
      await d.at(1);
      await d.card(`<h1>Ctrl + /</h1><p>Every shortcut, one key away</p>`);
    },
  },
];
