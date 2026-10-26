// Interface tour: the canvas, the Add Node palette, the parameter panel, the
// preview window and the Output. Three to four minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-interface.mjs
//
// Same format as scenes.mjs. Narration follows docs/interface.md (Main
// Interface Elements, Canvas Controls, Right-Click Menu, Parameter Panel,
// Preview Window, Status Bar). The preview's controls are the ones
// src/ui/FloatingGPUPreview.js builds; fullscreen there has no Escape key, so
// the narration says to click the button again.

export const title = 'Rhizomium: interface tour';
export const name = 'rhizomium-interface';

export const lexicon = {
  '.rz': 'dot R Z',
};

const BLANK = { x: 1500, y: 1000 }; // empty canvas, clear of the preview window

/** Ease the viewport by (dx, dy) pixels, the way a slow pan would look. */
const glide = (d, dx, dy, ms = 900) => d.page.evaluate(([dx, dy, ms]) => new Promise((done) => {
  const v = window.editor.viewport, x0 = v.offsetX, y0 = v.offsetY, t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms), e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    v.offsetX = x0 + dx * e;
    v.offsetY = y0 + dy * e;
    window.editor.markDirty?.('tour-pan');
    if (t < 1) requestAnimationFrame(step); else done();
  };
  requestAnimationFrame(step);
}), [dx, dy, ms]).catch(() => {});

/**
 * In one smooth move, zoom so the graph is at most `maxW` pixels wide and
 * place its left edge at `left`, its middle at height `cy` - clear of the
 * preview window.
 */
const placeGraph = (d, left, cy, maxW, ms = 1200) => d.page.evaluate(([left, cy, maxW, ms]) => new Promise((done) => {
  const ns = window.editor.graph.nodes;
  if (!ns.length) return done();
  const r = document.getElementById('ui-canvas').getBoundingClientRect();
  const x0 = Math.min(...ns.map((n) => n.x)), x1 = Math.max(...ns.map((n) => n.x + (n.w || 180)));
  const y0 = Math.min(...ns.map((n) => n.y)), y1 = Math.max(...ns.map((n) => n.y + 200));
  const v = window.editor.viewport, s0 = v.scale, ox0 = v.offsetX, oy0 = v.offsetY;
  const s1 = Math.min(s0, maxW / (x1 - x0));
  const ox1 = left - r.left - x0 * s1, oy1 = cy - r.top - ((y0 + y1) / 2) * s1;
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms), e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    v.scale = s0 + (s1 - s0) * e;
    v.offsetX = ox0 + (ox1 - ox0) * e;
    v.offsetY = oy0 + (oy1 - oy0) * e;
    window.editor.markDirty?.('tour-pan');
    if (t < 1) requestAnimationFrame(step); else done();
  };
  requestAnimationFrame(step);
}), [left, cy, maxW, ms]).catch(() => {});

const previewBtn = (d, cls) => d.page.locator(`.floating-gpu-preview .${cls}`).first();

export default [
  {
    id: 'intro',
    title: 'Interface tour',
    chapter: false,
    say: `This is a tour of the Rhizomium editor.
      In about three minutes you'll know your way around the canvas, the Add Node palette, the parameter panel, the preview, and the Output.`,
    async run(d) {
      await d.card(`<h1>Interface tour</h1><p>Rhizomium <span class="accent">·</span> canvas, nodes, parameters, preview, output</p>`);
      await d.at(1, 3);
      await d.card('');
      await d.click(d.page.getByText('Start New Graph').first(), { settle: 1200 });
      // The starter graph opens under the preview window; bring it into view
      // once the new graph has finished loading (it resets the viewport).
      await d.wait(1.5);
      await glide(d, 300, 520);
    },
  },

  // docs/interface.md - Main Interface Elements, Status Bar
  {
    id: 'layout',
    title: 'The four areas',
    say: `The editor has four main areas.
      Along the top, the menu bar: File, Edit, View, Node, Tools, Window and Help.
      Beside it, the status tells you whether the shader is idle or has just compiled.
      The preview window floats over the canvas and shows the render live.
      And the large dark area is the canvas, where you build the node graph.
      Along the bottom, the status bar shows the zoom, the Live render toggle, node and wire counts, and the frame rate.`,
    async run(d) {
      await d.at(1);
      await d.highlight('#top-menu-bar', 'Menu bar');
      await d.at(2);
      await d.clearHighlights();
      await d.highlight('#status', 'Status');
      await d.at(3);
      await d.clearHighlights();
      await d.highlight('.floating-gpu-preview', 'Preview');
      await d.at(4);
      await d.clearHighlights();
      for (const n of await d.nodes()) await d.highlight(await d.nodeRect(n.id, 200));
      await d.at(5);
      await d.clearHighlights();
      await d.highlight('.rz-sb-zoom', 'Zoom');
      await d.highlight('.rz-sb-render', 'Live');
      await d.highlight('.rz-sb-nodes', 'Nodes · wires');
      await d.wait(3);
      await d.clearHighlights();
    },
  },

  // docs/interface.md - Canvas, Canvas Controls
  {
    id: 'canvas',
    title: 'The canvas',
    say: `Drag with the middle mouse button to pan around the canvas.
      The mouse wheel zooms, centred on the cursor.
      Click a node to select it, and click empty canvas to deselect.
      Right-click and drag across empty canvas to box-select several nodes at once, then drag any of them to move the group.
      Press F to frame the selection, or the whole graph when nothing is selected.
      Then zoom back out whenever you need room to work.`,
    async run(d) {
      await d.pan(-260, -140, { x: 1300, y: 760 });
      await d.pan(260, 140, { x: 1040, y: 620 });
      await d.at(1);
      await d.zoom({ x: 1100, y: 700 }, 2);
      await d.wait(0.6);
      await d.zoom({ x: 1100, y: 700 }, -2);
      await d.at(2);
      const nodes = await d.nodes();
      if (nodes[0]) await d.click(await d.title(nodes[0].id), { settle: 900 });
      await d.click(BLANK, { settle: 400 });
      await d.at(3);
      // Box from above-left of the graph to below-right of it.
      const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
      const tl = await d.world(Math.min(...xs) - 60, Math.min(...ys) - 60);
      const br = await d.world(Math.max(...nodes.map((n) => n.x + (n.w || 180))) + 60, Math.max(...ys) + 260);
      await d.safe('box select', async () => {
        await d.move(tl);
        await d.page.mouse.down({ button: 'right' });
        await d.move(br, 1100);
        await d.page.mouse.up({ button: 'right' });
      });
      await d.wait(0.4);
      if (nodes[0]) {
        const from = await d.title(nodes[0].id);
        await d.drag(from, { x: from.x + 80, y: from.y + 40 }, { ms: 700 });
      }
      await d.at(4);
      await d.key('f', 900);
      await d.click(BLANK, { settle: 300 });
      await d.key('f', 700);
      await d.at(5);
      // Make room for the next chapter: clear of the preview, space below.
      await placeGraph(d, 780, 440, 1040);
    },
  },

  // docs/interface.md - Right-Click Menu, Adding Nodes, Connecting Nodes
  {
    id: 'add-node',
    title: 'The Add Node palette',
    say: `Right-click empty canvas to open the Add Node palette.
      Down the side is a rail of twelve categories, from Input and Output to Effects, and Tab steps through them.
      But typing is faster: the search covers every node in the editor by name, whatever its category.
      Type circle, and press Enter to place the highlighted result.
      The node lands where you right-clicked.
      To connect it, drag from its output pin on the right to an input pin on the left of the next node.
      Wiring the Circle into the Gradient replaces the noise, and the preview updates straight away.`,
    async run(d) {
      const grad = await d.node('ComputeGradient');
      // Below the graph, left of the Gradient, so the Circle and its wire stay
      // on screen.
      const g = grad ? await d.world(grad.x, grad.y) : { x: 1100, y: 400 };
      const spot = { x: Math.max(760, g.x - 320), y: Math.min(820, g.y + 300) };
      await d.rightClick(spot, { settle: 600 });
      await d.at(1);
      await d.highlight('.rz-palette', 'Categories');
      for (let i = 0; i < 4; i++) await d.key('Tab', 700);
      await d.clearHighlights();
      await d.at(2);
      await d.key('Escape', 400);
      await d.at(3);
      const before = new Set((await d.nodes()).map((n) => n.id));
      await d.rightClick(spot, { settle: 500 });
      await d.type('circle', { delay: 110 });
      await d.wait(0.6);
      await d.key('Enter', 700);
      const circle = (await d.nodes()).find((n) => !before.has(n.id) && n.kind === 'Circle');
      await d.at(4);
      if (circle) await d.highlight(await d.nodeRect(circle.id, 200), 'Placed here');
      await d.at(5);
      await d.clearHighlights();
      if (circle && grad) await d.wire(circle.id, 0, grad.id, 0);
      await d.at(6);
      await d.highlight('.floating-gpu-preview', 'Updated');
      await d.wait(2.5);
      await d.clearHighlights();
    },
  },

  // docs/interface.md - Editing Parameters, Parameter Panel, Parameter Types
  {
    id: 'parameters',
    title: 'The parameter panel',
    say: `Double-click a node to open its parameter panel.
      The header names the node, and below it each parameter has its own block, in the order the node declares them.
      Type a number straight into the field, like a softer edge for the circle, and the change applies immediately.
      Start the value with an equals sign to drive it from an expression instead, like the sine of time.
      Under the field, the panel shows what the value evaluates to right now, and the range the parameter accepts.
      On the right, three buttons: copy a reference to this parameter, bind it to MIDI or another parameter, and add a keyframe for the timeline.
      Click outside the panel to close it.`,
    async run(d) {
      const circle = (await d.node('Circle'))?.id;
      await d.openParams(circle);
      await d.at(1);
      await d.highlight('.parameter-panel', 'Circle parameters');
      await d.at(2);
      await d.clearHighlights();
      // The panel opens short; Softness is the block below Radius.
      await d.safe('scroll to Softness', () => d.paramBlock('Softness').scrollIntoViewIfNeeded());
      await d.setParam('Softness', '0.3');
      await d.safe('scroll to Radius', () => d.paramBlock('Radius').scrollIntoViewIfNeeded());
      await d.at(3);
      await d.setParam('Radius', '=sin(time) * 0.15 + 0.3');
      await d.at(4);
      await d.highlight(d.paramBlock('Radius'), 'Value and range');
      await d.at(5);
      await d.clearHighlights();
      await d.highlight(d.paramBlock('Radius').locator('.binding-controls').first(), 'Copy reference · bind · keyframe');
      await d.at(6);
      await d.clearHighlights();
      await d.click(BLANK, { settle: 500 });
    },
  },

  // docs/interface.md - Preview Window, Node Previews; src/ui/FloatingGPUPreview.js
  {
    id: 'preview',
    title: 'The preview window',
    say: `The preview window shows the render as you build it.
      Drag its title bar to move it, and drag a corner to resize it.
      Its controls sit in the top-right corner: preview settings, dock to the corner, lock its position, fullscreen, and close.
      Fullscreen fills the screen with the render; click the button again to come back.
      If you close the preview, View, Toggle Preview Panel brings it back.
      Nodes have their own small previews too: the eye button in a node's header shows or hides its thumbnail.`,
    async run(d) {
      const header = d.page.locator('.floating-gpu-preview .preview-header').first();
      const box = await d.safe('preview header', () => header.boundingBox());
      await d.at(1);
      if (box) {
        const grip = { x: box.x + 60, y: box.y + box.height / 2 };
        const away = { x: grip.x + 220, y: grip.y + 80 };
        await d.drag(grip, away);
        await d.drag(away, grip);
      }
      await d.at(2);
      await d.highlight('.floating-gpu-preview .preview-controls', 'Controls');
      for (const cls of ['btn-settings', 'btn-dock', 'btn-lock', 'btn-fullscreen', 'btn-close']) {
        await d.safe(`hover ${cls}`, () => d.move(previewBtn(d, cls)));
        await d.wait(0.45);
      }
      await d.clearHighlights();
      await d.at(3);
      await d.click(previewBtn(d, 'btn-fullscreen'), { settle: 1800 });
      await d.click(previewBtn(d, 'btn-fullscreen'), { settle: 500 });
      // If the button was out of reach, leave fullscreen anyway.
      await d.page.evaluate(() => {
        const p = window.floatingPreview;
        if (p?.isFullscreen) p.toggleFullscreen();
      }).catch(() => {});
      await d.at(4);
      await d.menu('View');
      await d.safe('panels submenu', () => d.move(d.page.locator('#dropdown-view .menu-submenu-trigger', { hasText: 'Panels' }).first()));
      await d.wait(0.4);
      await d.highlight('#btn-toggle-preview-panel', 'Toggle Preview Panel');
      await d.wait(1.2);
      await d.clearHighlights();
      await d.closeMenus();
      await d.at(5);
      const grad = (await d.node('ComputeGradient'))?.id;
      if (grad) await d.highlight(await d.nodeRect(grad, 200), 'Node thumbnail');
      await d.wait(2);
      await d.clearHighlights();
    },
  },

  // docs/interface.md - Status Bar, Working with Nodes; docs/multi-screen.md
  {
    id: 'output',
    title: 'The Output',
    say: `Every graph ends at the Output node, and only what reaches it is drawn, in the preview and everywhere else.
      If the preview is black, check that something is wired into the Output.
      To show the render on a projector or a second display, with no interface around it, use View, Open or Close Output.
      Output Screens, just below, spreads one composition across several displays.
      And File, Export renders a still image or a video file from the same Output.
      It tells you the size, length and file type before you press the button.`,
    async run(d) {
      const out = await d.node('OutputFinal');
      if (out) await d.highlight(await d.nodeRect(out.id, 200), 'Output');
      await d.at(1);
      await d.clearHighlights();
      if (out) await d.highlight({ ...(await d.pin(out.id, 'in', 0)), width: 1, height: 1 }, 'Wire in here', { pad: 14 });
      await d.at(2);
      await d.clearHighlights();
      // These rows exist only in the desktop app (main.js reveals them under
      // Tauri); the recording runs in the browser build, so show them for the
      // shot. They are pointed at, never clicked.
      await d.page.evaluate(() => {
        for (const id of ['sep-second-monitor', 'btn-second-monitor', 'btn-output-screens']) {
          document.getElementById(id)?.style.removeProperty('display');
        }
      }).catch(() => {});
      await d.menu('View');
      await d.highlight('#btn-second-monitor', 'Open / Close Output');
      await d.at(3);
      await d.clearHighlights();
      await d.highlight('#btn-output-screens', 'Output Screens');
      await d.at(4);
      await d.clearHighlights();
      await d.closeMenus();
      await d.menu('File', 'Export');
      await d.highlight('#export-panel', 'Export');
      await d.at(5, 2);
      await d.clearHighlights();
      await d.closeWindow('#export-panel');
    },
  },

  // docs/interface.md - Window menu, docs/shortcuts.md
  {
    id: 'outro',
    title: 'Next steps',
    say: `That's the whole interface: the canvas, the palette, the parameter panel, the preview, and the Output.
      If you ever lose a panel, Window, Reset Layout puts everything back where it started, and Help, Shortcuts lists every key binding.
      Next, try the Quick Start guide to build your first graph from scratch.`,
    async run(d) {
      await d.at(1);
      await d.menu('Window');
      await d.wait(2.5);
      await d.closeMenus();
      await d.menu('Help', 'Shortcuts');
      await d.wait(2.5);
      await d.closeWindow('.keymap-overlay');
      await d.at(2);
      await d.card(`<h1>You know your way around</h1><p>Next: the Quick Start guide <span class="accent">·</span> your first graph</p>`);
    },
  },
];
