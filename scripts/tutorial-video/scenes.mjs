// The tour, one entry per chapter. `say` is the narration; `run` acts it out.
// Inside `run`, `await d.at(n)` waits until the narrator begins sentence n
// (0-based), so actions land on the words that describe them. A scene lasts as
// long as its narration or its actions, whichever is longer.
//
// Narration follows the docs/ pages named in each scene's comment - when a
// feature changes, update the words there and here together. Avoid "e.g." and
// other mid-sentence full stops: sentences are split on them.

// Pronunciations: captions show the left-hand side, the voice reads the right.
// Piper already says Rhizomium, MIDI, WGSL, NDI and UV correctly; check a new
// term with PiperVoice.phonemize() before adding it here.
export const lexicon = {
  '.rz': 'dot R Z',
};

const BLANK = { x: 1500, y: 1000 }; // empty canvas, clear of the preview window
const MOD = 'ControlOrMeta';

export default [
  // README.md, docs/quickstart-web.md - Step 1
  {
    id: 'welcome',
    title: 'Welcome',
    chapter: false,
    say: `Welcome to Rhizomium, a node editor for real-time generative visuals.
      You build a shader by connecting nodes, drive any parameter from audio, MIDI, OSC or a timeline, and send the result to a projector, a video wall or an NDI feed.
      It runs in the browser on WebGPU, with no installation and no account.
      When it opens, the welcome dialog offers a new graph, a saved project, your automatic backups, and three finished patches to take apart.
      Let's start a new graph.`,
    async run(d) {
      await d.card(`<h1>Rhizomium</h1><p>A feature tour <span class="accent">·</span> real-time generative visuals</p>`);
      await d.at(2, 1.2);
      await d.card('');
      await d.at(3);
      await d.highlight(d.page.getByText('Start New Graph').first(), 'New graph');
      await d.wait(1.5);
      await d.clearHighlights();
      await d.highlight(d.page.getByText('Aurora Field').first().locator('xpath=../..'), 'Starter patches');
      await d.at(4);
      await d.clearHighlights();
      await d.click(d.page.getByText('Start New Graph').first(), { settle: 1200 });
    },
  },

  // docs/quickstart-web.md - Steps 2 to 4, docs/interface.md - Canvas Controls
  {
    id: 'first-graph',
    title: 'Your first graph',
    say: `A new graph is never empty. It starts with Compute Noise, feeding a Gradient, feeding the Output.
      Drag with the middle mouse button to pan the canvas, and use the wheel to zoom.
      To build from scratch, shift-click the three starter nodes and delete them.
      Now right-click the canvas. The Add Node palette opens, with a search field and twelve categories down the side.
      Type to search every node by name. Here's U V, which gives every pixel its coordinates.
      Next, a Circle, then a Gradient to colour it, and finally the Output node.
      To connect nodes, drag from an output pin on the right of one node to an input pin on the left of the next.
      Wire U V into Circle, Circle into Gradient, and Gradient into the Output.
      As soon as the Output is connected, the shader compiles and the preview shows the result.`,
    async run(d) {
      await d.at(1);
      await d.pan(320, 280, { x: 1300, y: 560 });
      await d.zoom({ x: 1200, y: 700 }, -1);
      await d.zoom({ x: 1200, y: 700 }, 1);
      await d.at(2);
      const starters = await d.nodes();
      await d.page.keyboard.down('Shift');
      for (const n of starters) await d.click(await d.title(n.id), { settle: 200 });
      await d.page.keyboard.up('Shift');
      await d.key('Delete', 600);

      await d.at(3);
      const uv = await d.addNode('uv', { x: 300, y: 640 });
      await d.at(5);
      const circle = await d.addNode('circle', { x: 680, y: 640 });
      const grad = await d.addNode('gradient', { x: 1040, y: 640 });
      const out = await d.addNode('output', { x: 1420, y: 640 });
      await d.at(6);
      await d.wire(uv, 0, circle, 0);
      await d.at(7);
      await d.wire(circle, 0, grad, 0);
      await d.wire(grad, 0, out, 0);
      await d.at(8);
      await d.highlight('#gpu-canvas', 'Preview');
    },
  },

  // docs/quickstart-web.md - Step 5, docs/parameter-expressions.md
  {
    id: 'expressions',
    title: 'Parameters and expressions',
    say: `Double-click a node to open its parameters.
      Every number can be typed in directly, or turned into an expression by starting it with an equals sign.
      Let's make the Circle's radius breathe: equals, sine of time, times 0.15, plus 0.3.
      Under the field, the panel shows what the expression evaluates to right now, and the range the parameter accepts.
      Expressions can read time, the mouse, audio levels, and other parameters.
      They run in a small interpreter, never through eval, so opening someone else's patch can't run code in your browser.`,
    async run(d) {
      const circle = (await d.node('Circle'))?.id;
      await d.openParams(circle);
      await d.at(2);
      await d.setParam('Radius', '=sin(time) * 0.15 + 0.3');
      await d.at(3);
      await d.highlight(d.paramBlock('Radius'), 'Value and range');
      await d.at(5, 1.5);
      await d.clearHighlights();
    },
  },

  // docs/interface.md - Right-Click Menu, Node Anatomy, Node Previews
  {
    id: 'node-library',
    title: 'The node library',
    say: `There are more than a hundred and thirty nodes, filed under twelve categories: Input, Output, Math, Vector, Generators, Transform, Modifiers, Utility, Blend, Texture, Dynamics and Effects.
      In the palette, Tab steps through the categories, and the arrow keys and Enter place a node without touching the mouse.
      Every node has the same anatomy: a header coloured by category, inputs on the left, outputs on the right, and a live preview thumbnail.
      The buttons in the header hide the thumbnail or cycle its size.
      Right-click a node for its own menu: parameters, duplicate, delete, and reset to defaults.`,
    async run(d) {
      await d.click(BLANK, { settle: 200 });
      await d.rightClick({ x: 1200, y: 900 }, { settle: 600 });
      for (let i = 0; i < 6; i++) await d.key('Tab', 650);
      await d.at(1, 2);
      await d.key('Escape', 400);
      await d.at(2);
      const circle = (await d.node('Circle'))?.id;
      if (circle) await d.highlight(await d.nodeRect(circle), 'Circle');
      await d.at(4);
      await d.clearHighlights();
      if (circle) await d.rightClick(await d.body(circle), { settle: 600 });
      await d.wait(3);
      await d.key('Escape');
      await d.click(BLANK, { settle: 200 });
    },
  },

  // docs/audio-web.md
  {
    id: 'audio',
    title: 'Audio reactivity',
    say: `Open Tools, Audio, to make the visuals listen.
      Pick a source: an audio file, a microphone or line-in, or the system's own sound, and the channel meters start moving.
      The analysis reaches your patch through expressions.
      audioEnvelope is the overall level, and there are separate envelopes for the bass, mids and highs, all between zero and one.
      So setting the radius to 0.2, plus the bass envelope times 0.4, makes the circle kick with the drums.`,
    async run(d) {
      await d.menu('Tools', 'Audio');
      await d.at(1);
      await d.highlight('#audio-settings-panel', 'Audio');
      const panel = d.page.locator('#audio-settings-panel');
      await d.click(panel.getByText(/Mic/).first(), { settle: 600 });
      await d.click(panel.getByText(/Listen/).first(), { settle: 600 });
      await d.at(2);
      await d.clearHighlights();
      await d.closeWindow('#audio-settings-panel');
      const circle = (await d.node('Circle'))?.id;
      await d.openParams(circle);
      await d.at(4);
      await d.setParam('Radius', '=0.2 + audioEnvelopeBass * 0.4');
      await d.wait(2);
      await d.click(BLANK, { settle: 200 });
    },
  },

  // docs/midi.md, src/osc/README.md, docs/interface.md - Parameter Panel
  {
    id: 'midi-osc',
    title: 'MIDI and OSC control',
    say: `Hardware controllers work too. Tools, MIDI Settings, lists your connected devices.
      MIDI is plain Web MIDI, so there's nothing to install.
      To map a knob, click a parameter, press MIDI Learn, and move the control.
      OSC from a DAW or another app arrives through a small local bridge that starts with the dev server.
      Open Tools, OSC Receiver, connect, and point your sender at port 9000 on this machine.
      OSC Learn maps a control the same way.
      Every parameter also has bind and copy-reference buttons, so one parameter can drive another.`,
    async run(d) {
      await d.menu('Tools', 'MIDI Settings');
      await d.highlight('#midi-settings-panel', 'MIDI');
      await d.at(2);
      await d.highlight(d.page.locator('#midi-settings-panel').getByText(/MIDI Learn/).first(), 'Learn');
      await d.at(3);
      await d.clearHighlights();
      await d.menu('Tools', 'MIDI Settings'); // the menu row toggles it shut
      await d.menu('Tools', 'OSC Receiver');
      await d.at(4);
      await d.highlight('#osc-settings-panel', 'OSC');
      await d.at(5);
      await d.clearHighlights();
      await d.highlight(d.page.locator('#osc-settings-panel').getByText(/OSC Learn/).first(), 'Learn');
      await d.at(6);
      await d.clearHighlights();
      await d.menu('Tools', 'OSC Receiver');
      const circle = (await d.node('Circle'))?.id;
      await d.openParams(circle);
      await d.highlight(d.paramBlock('Radius').locator('.binding-controls').first(), 'Bind · copy reference · keyframe');
      await d.wait(3);
      await d.clearHighlights();
      await d.click(BLANK, { settle: 200 });
    },
  },

  // docs/timeline.md
  {
    id: 'timeline',
    title: 'Timeline and keyframes',
    say: `For scripted motion there's the timeline, under View, Timeline.
      Move the playhead, change a parameter, and add a keyframe, either with the keyframe button beside the parameter or by pressing K.
      Do that at another time, and Rhizomium interpolates between them, linear, eased or along a curve.
      Each animated parameter gets its own track, and the whole thing can loop for a set or a music video.`,
    async run(d) {
      await d.menu('View', 'Timeline');
      await d.highlight('#timeline-panel', 'Timeline');
      await d.at(1);
      await d.clearHighlights();
      const circle = (await d.node('Circle'))?.id;
      await d.openParams(circle);
      await d.highlight(d.paramBlock('Smooth').locator('.keyframe-btn').first(), 'Keyframe');
      await d.at(2);
      await d.clearHighlights();
      await d.click(BLANK, { settle: 200 });
      await d.click(d.page.locator('#timeline-panel button[title*="Play" i]').first());
      await d.at(3, 2);
      await d.click(d.page.locator('#timeline-panel button[title*="Pause" i], #timeline-panel button[title*="Stop" i]').first());
      await d.menu('View', 'Timeline');
    },
  },

  // docs/compute-nodes.md, docs/quickstart-web.md - starter patches
  {
    id: 'compute',
    title: 'Compute nodes',
    say: `Let's open one of the starter patches, Aurora Field.
      Its nodes are compute nodes: GPU programs that run before the final fragment shader, in parallel across thousands of threads.
      They're what powers particle systems, reaction-diffusion, fluid simulation, cellular automata, blurs and feedback trails.
      Compute nodes live in the same categories as everything else, and the editor bridges between compute and fragment nodes automatically.
      Here, one noise field is coloured by a gradient and also used to displace itself, a single source feeding two places.`,
    async run(d) {
      await d.loadStarter('Aurora Field');
      await d.frameAll();
      await d.at(1);
      const all = await d.nodes();
      for (const n of all.slice(0, 3)) {
        await d.highlight(await d.nodeRect(n.id), n.kind.replace(/^Compute/, 'Compute '));
        await d.wait(0.9);
      }
      await d.at(3);
      await d.clearHighlights();
      const first = all[0]?.id;
      if (first) await d.openParams(first);
      await d.at(4, 2.5);
      await d.click(BLANK, { settle: 200 });
    },
  },

  // docs/interface.md - Console Window, Shader Compiler, GLSL Utilities
  {
    id: 'shader-code',
    title: 'The generated shader',
    say: `Everything you wire up compiles to a single WGSL shader, and you can read it.
      View, Show Console, shows the generated code, ready to copy or export.
      The Shader Compiler hands the code to your GPU driver and lists any errors and warnings with their line numbers, recompiling as you edit.
      And GLSL Utilities converts GLSL, including Shadertoy code, into WGSL for the Custom GLSL node, with a library of snippets ready to drop in.`,
    async run(d) {
      await d.at(1);
      await d.menu('View', 'Show Console');
      await d.highlight('#code-console', 'Generated WGSL');
      await d.at(2);
      await d.clearHighlights();
      await d.menu('View', 'Console');
      await d.key(`${MOD}+Alt+C`, 900);
      await d.at(3);
      await d.closeWindow('#shader-compiler-window');
      await d.key(`${MOD}+Alt+G`, 900);
      const glu = d.page.locator('#glsl-utilities-window');
      await d.click(glu.getByText(/^Sample$/).first(), { settle: 500 });
      await d.click(glu.getByText(/Convert to WGSL/).first(), { settle: 900 });
      await d.wait(2.5);
      await d.closeWindow('#glsl-utilities-window');
    },
  },

  // docs/textures.md
  {
    id: 'textures',
    title: 'Images and video',
    say: `Bring in your own pictures with the Texture 2D node.
      Choose a file or drop one onto the node: PNG, JPEG and WebP images, or MP4, WebM and MOV video, which starts playing straight away.
      Feed it coordinates from a U V node, run it through any effect, and mix it with the procedural parts of your patch.`,
    async run(d) {
      const tex = await d.addNode('texture 2d', { x: 1380, y: 880 });
      await d.at(1);
      if (tex) {
        await d.highlight(await d.nodeRect(tex), 'Texture 2D');
        await d.wait(2.5);
        await d.clearHighlights();
        await d.openParams(tex);
      }
      await d.at(2, 2);
      await d.click(BLANK, { settle: 200 });
      if (tex) {
        await d.click(await d.title(tex), { settle: 200 });
        await d.key('Delete', 400);
      }
    },
  },

  // docs/field-visualization.md, docs/camera-controls.md
  {
    id: 'three-d',
    title: '3D fields',
    say: `Compute output can also be seen in three dimensions.
      The 3D Field Visualizer node turns a compute field into geometry, either as a surface, or as a field of instanced shapes.
      Press control 3 to open the 3D viewport, then drag to orbit the camera, and scroll to zoom.`,
    async run(d) {
      const src = (await d.nodes())[0];
      const fm = await d.addNode('3d field', { x: 1120, y: 880 });
      await d.at(1);
      if (src && fm) await d.wire(src.id, 0, fm, 0);
      await d.at(2);
      await d.key(`${MOD}+3`, 1200);
      await d.highlight('#viewport3d-panel', '3D viewport');
      await d.wait(1);
      await d.clearHighlights();
      await d.drag({ x: 1600, y: 300 }, { x: 1720, y: 340 }, { ms: 1400 });
      await d.zoom({ x: 1620, y: 300 }, 2);
      await d.wait(1.5);
      await d.key(`${MOD}+3`, 600);
      if (fm) {
        await d.click(await d.title(fm), { settle: 200 });
        await d.key('Delete', 400);
      }
    },
  },

  // docs/interface.md - VJ Control Panel, src/performer/README.md
  {
    id: 'performance',
    title: 'Live performance',
    say: `For live sets, View, VJ Control stores whole graphs as scenes and switches between them.
      Capture the current graph as a scene, choose how one gives way to the next, crossfade for example, and set the length of the transition.
      Tap in the tempo, and use the master opacity and speed sliders to ride the whole output without touching the graph.
      Beside it is the AI Performer, a paid feature: you play the music, it plays the visuals, following a written score of what the set may do.`,
    async run(d) {
      await d.menu('View', 'VJ Control');
      const vj = d.page.locator('#vj-control-panel');
      await d.highlight('#vj-control-panel', 'VJ Control');
      await d.at(1);
      await d.clearHighlights();
      await d.click(vj.getByText(/Capture Current/).first(), { settle: 800 });
      await d.at(2);
      for (let i = 0; i < 4; i++) await d.click(vj.getByText(/^Tap$/).first(), { settle: 330 });
      await d.at(3);
      await d.closeWindow('#vj-control-panel');
      await d.menu('View', 'AI Performer');
      await d.highlight('#performer-panel', 'AI Performer');
      await d.wait(3);
      await d.clearHighlights();
      await d.closeWindow('#performer-panel');
    },
  },

  // docs/profiler.md, docs/interface.md - Resolution, Status Bar
  {
    id: 'settings',
    title: 'Resolution and performance',
    say: `View, Preview and Export Settings is the one place resolution and frame rate are set, and the preview, exports and publishing all follow it.
      Presets run from 512 square up to 4K, and the frame rate is either your display's refresh or a fixed step.
      The status bar shows the frame rate at all times.
      For detail, the Compute Profiler breaks each frame down by node, so you can see which one costs the most.`,
    async run(d) {
      await d.menu('View', 'Preview / Export Settings');
      await d.highlight('#preview-export-settings-window', 'Preview / Export Settings');
      await d.at(2);
      await d.clearHighlights();
      await d.closeWindow('#preview-export-settings-window');
      await d.highlight({ x: 1700, y: 1048, width: 210, height: 26 }, 'Frame rate', { pad: 4 });
      await d.at(3);
      await d.clearHighlights();
      await d.key(`${MOD}+Alt+P`, 800);
      await d.highlight('#compute-profiler-overlay', 'Profiler');
      await d.wait(3);
      await d.clearHighlights();
      await d.key(`${MOD}+Alt+P`, 500);
    },
  },

  // docs/multi-screen.md, src/mapping/README.md, src/output/README.md, src/ui/ExportPanel.js
  {
    id: 'output',
    title: 'Getting it out',
    say: `When it's time to leave the editor, File, Export renders a still or a video, and says exactly what you'll get, its size, length and file type, before you press the button.
      Projection Mapping corner-pins the output onto real surfaces, with soft edges for blending projectors, and a test grid for lining them up.
      View, Open Output puts the render on another display with no interface around it, and with Cloude Plus, Output Screens spreads one composition across a projector panorama or a video wall.
      And with the local N D I bridge running, View, NDI Output sends the render to a vision mixer, OBS, or another machine on the network.`,
    async run(d) {
      await d.menu('File', 'Export');
      await d.highlight('#export-panel', 'Export');
      await d.at(1);
      await d.clearHighlights();
      await d.closeWindow('#export-panel');
      await d.menu('Tools', 'Projection Mapping');
      await d.wait(2);
      await d.at(2);
      await d.closeWindow('#mapping-panel');
      await d.menu('View');
      await d.at(3);
      await d.highlight(d.page.locator('#dropdown-view button:visible', { hasText: 'NDI Output' }).first(), 'NDI');
      await d.wait(3);
      await d.clearHighlights();
      await d.closeMenus();
    },
  },

  // docs/save-load-web.md, docs/web-viewer.md
  {
    id: 'saving',
    title: 'Saving and sharing',
    say: `Your work saves as you go, and Control S saves on demand.
      Patches are .rz files, and the File Manager keeps them organised.
      Backups are written automatically while you work, so an experiment that goes wrong is never the end of a patch.
      With a Cloude plan, File, Open in Web Viewer shows the patch running live in a browser tab, rendered on the visitor's own GPU, the way a shared link would.`,
    async run(d) {
      await d.menu('File');
      await d.highlight(d.page.locator('#dropdown-file'), 'File');
      await d.at(1);
      await d.clearHighlights();
      await d.closeMenus();
      await d.menu('File', 'File Manager');
      await d.at(2);
      await d.closeWindow('.file-manager-overlay');
      await d.menu('File', 'Backups');
      await d.at(3);
      await d.closeWindow('.backup-dialog-overlay');
      await d.menu('File', 'Web Viewer Tool');
      await d.wait(3);
      await d.closeWindow('#web-viewer-tool');
    },
  },

  // docs/collab-space.md, README.md - What is open, and what is a service
  {
    id: 'collab-ai',
    title: 'Collaboration and AI',
    say: `Tools, Collab Space puts two or more artists on one canvas: the same nodes, the same wires, and each other's pointers.
      The AI Assistant helps refactor a patch and acts as a creative director, and Patch Review reads a patch and points out what could be better.
      These are part of the paid plans, and sign in through Tools, Account.
      Everything else you've seen is free and open source, and runs offline.`,
    async run(d) {
      await d.menu('Tools', 'Collab Space');
      await d.highlight('.rz-collab', 'Collab space');
      await d.at(1);
      await d.clearHighlights();
      await d.closeWindow('.rz-collab');
      await d.menu('Tools', 'AI Assistant');
      await d.wait(3);
      await d.closeWindow('.ai-dock');
      await d.menu('Tools', 'Patch Review');
      await d.at(2);
      await d.closeWindow('.review-dock');
    },
  },

  // docs/interface.md - Window menu, docs/shortcuts.md
  {
    id: 'workflow',
    title: 'Layouts and shortcuts',
    say: `A few habits make all of this faster.
      Press F to frame the selection, or the whole graph when nothing is selected.
      The Window menu switches layouts: the default, a minimal one with nothing but the graph, and your own saved arrangement.
      And Help, Shortcuts, lists every key binding in one searchable sheet.`,
    async run(d) {
      await d.at(1);
      await d.frameAll();
      await d.at(2);
      await d.key(`${MOD}+Alt+3`, 1500);
      await d.wait(1.5);
      await d.key(`${MOD}+Alt+1`, 1000);
      await d.at(3);
      await d.menu('Help', 'Shortcuts');
      await d.wait(3.5);
      await d.closeWindow('.keymap-overlay');
    },
  },

  // README.md - Desktop app, Local bridges, Contributing
  {
    id: 'outro',
    title: 'Where to go next',
    say: `Rhizomium also ships as a desktop app for Windows, which adds true fullscreen output windows on every display.
      It's open source under the A G P L, and the documentation covers every node and feature in depth.
      Open a starter patch, take it apart, and make something of your own.
      Thanks for watching.`,
    async run(d) {
      await d.loadStarter('Mirror Cells');
      await d.frameAll();
      await d.at(2, 1.5);
      await d.card(`<h1>Rhizomium</h1><p>studio.tenderworld.org <span class="accent">·</span> Docs at studio.tenderworld.org/docs</p>`);
    },
  },
];
