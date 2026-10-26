// Install and first launch: a short tutorial, under three minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-install.mjs
//
// Same format as scenes.mjs. The installer, SmartScreen and the Start menu
// happen outside the editor, where the recorder can't film, so those chapters
// are told on cards; first launch and troubleshooting are filmed in the editor.
//
// Narration follows docs/quickstart-web.md (Step 1, Need Help), docs/faq.md
// (What GPU do I need?) and the desktop branch of src/ui/deviceCheckBoot.js.
// docs/troubleshooting.md still describes the old browser build, so only its
// desktop-relevant advice is used here.

export const title = 'Rhizomium: install and first launch';
export const name = 'rhizomium-install';

export const lexicon = {
  '.rz': 'dot R Z',
  'MSI': 'M S I',
  'x64': 'x 64',
  'WebView2': 'Web View 2',
};

const card = (heading, items, foot = '') =>
  `<p class="accent">${heading}</p><ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>` +
  (foot ? `<small>${foot}</small>` : '');

// The desktop wording of the device check, from src/ui/deviceCheckBoot.js. The
// recording machine has a GPU, so the overlay is filled in by hand to show it.
const NO_WEBGPU = {
  title: 'WebGPU Not Available',
  message: 'Your graphics card or driver does not support WebGPU, which Rhizomium needs to render.',
  solutions: `<h3>To enable WebGPU:</h3><ul>
    <li>Update your graphics driver from NVIDIA, AMD or Intel</li>
    <li>Install the latest Windows updates</li>
    <li>Restart Rhizomium afterwards</li></ul>`,
};

export default [
  {
    id: 'intro',
    title: 'Install and first launch',
    chapter: false,
    say: `This video gets Rhizomium installed and running on Windows.
      We'll download it, check your graphics hardware, open the editor, and fix the case where nothing shows up.`,
    async run(d) {
      await d.card(`<h1>Install &amp; first launch</h1><p>Rhizomium for Windows <span class="accent">·</span> about three minutes</p>`);
    },
  },

  // docs/quickstart-web.md - Step 1; src-tauri/tauri.conf.json (msi + nsis)
  {
    id: 'download',
    title: 'Download and install',
    say: `Rhizomium is a desktop app for Windows 10 or Windows 11, sixty-four bit, and there's no web version.
      Open the Rhizomium releases page on GitHub.
      Under the newest release, download the file that ends in x64 setup.
      There's also an MSI package, if you prefer one.
      While Rhizomium is in beta the installer isn't signed yet, so Windows SmartScreen may say it protected your PC.
      Click More info, then Run anyway.
      Rhizomium runs on Microsoft's WebView2 runtime, which Windows 11 already has, and the installer fetches it if needed.
      When it finishes, open Rhizomium from the Start menu.`,
    async run(d) {
      await d.card(card('Requirements', ['Windows 10 or 11, 64-bit', 'Desktop app only <small>no browser version</small>']));
      await d.at(1);
      await d.card(card('Download', [
        '<code>github.com/Amirashkan/rhizomium/releases</code>',
        'Newest release → <code>Rhizomium_…_x64-setup.exe</code>',
        'or <code>Rhizomium_…_x64_en-US.msi</code>',
      ]));
      await d.at(4);
      await d.card(card('"Windows protected your PC"', [
        'Click <b>More info</b>',
        'Click <b>Run anyway</b>',
      ], 'Beta installers are not code-signed yet'));
      await d.at(6);
      await d.card(card('Install', [
        'WebView2 runtime: built into Windows 11, fetched by the installer if missing',
        'Start menu → <b>Rhizomium</b>',
      ]));
    },
  },

  // docs/faq.md - What GPU do I need?, Can I run Rhizomium on integrated graphics?
  {
    id: 'hardware',
    title: 'What hardware you need',
    say: `Rhizomium renders on your graphics card through WebGPU, so the GPU is what matters.
      Most cards from the last five to seven years work: NVIDIA GTX 900 series or newer, AMD RX 400 series or newer, and Intel Iris Xe or newer.
      Integrated graphics run it too, with less headroom for big graphs.
      Whatever you have, install the latest driver, because that's where WebGPU support comes from.`,
    async run(d) {
      const gpus = [
        '<b>NVIDIA</b> · GTX 900 series or newer',
        '<b>AMD</b> · RX 400 series or newer',
        '<b>Intel</b> · Iris Xe or newer',
      ];
      await d.card(`<h1>A WebGPU graphics card</h1><p>Most GPUs from the last 5–7 years</p>`);
      await d.at(1);
      await d.card(card('Supported GPUs', gpus));
      await d.at(2);
      await d.card(card('Supported GPUs', [...gpus, 'Integrated graphics work, with less headroom']));
      await d.at(3);
      await d.card(card('Before you start', ['Install the latest graphics driver from NVIDIA, AMD or Intel']));
    },
  },

  // docs/quickstart-web.md - Step 1
  {
    id: 'first-launch',
    title: 'First launch',
    say: `When Rhizomium starts, a splash window shows while it loads, then the welcome dialog opens.
      Start New Graph gives you a fresh canvas.
      Open Project File opens a saved .rz project, and Manage Backups opens the autosaves.
      Below are three finished patches to take apart later.
      Let's start a new graph.
      It isn't empty: Compute Noise feeds a Gradient, which feeds the Output, so the preview moves straight away.
      In the status bar, Live means the GPU is rendering.
      If you see moving colour in the preview, your install works.`,
    async run(d) {
      await d.card('');
      await d.at(1);
      await d.highlight(d.page.getByText('Start New Graph').first(), 'New graph');
      await d.at(2);
      await d.clearHighlights();
      await d.highlight(d.page.getByText('Open Project File').first(), 'Saved projects');
      await d.highlight(d.page.getByText('Manage Backups').first(), 'Autosaves');
      await d.at(3);
      await d.clearHighlights();
      await d.highlight(d.page.getByText('Aurora Field').first().locator('xpath=../..'), 'Starter patches');
      await d.at(4);
      await d.clearHighlights();
      await d.click(d.page.getByText('Start New Graph').first(), { settle: 1200 });
      // The starter graph opens under the preview window; bring it into view
      // once the new graph has finished loading (it resets the viewport).
      await d.wait(1.5);
      await d.page.evaluate(([dx, dy]) => new Promise((done) => {
        const v = window.editor.viewport, x0 = v.offsetX, y0 = v.offsetY, t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / 900), e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
          v.offsetX = x0 + dx * e;
          v.offsetY = y0 + dy * e;
          window.editor.markDirty?.('tour-pan');
          if (t < 1) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      }), [300, 520]).catch(() => {});
      await d.at(5);
      for (const n of await d.nodes()) await d.highlight(await d.nodeRect(n.id, 200));
      await d.wait(2.5);
      await d.clearHighlights();
      await d.highlight('#gpu-canvas', 'Preview');
      await d.at(6);
      await d.clearHighlights();
      await d.highlight('.rz-sb-render', 'Rendering');
      await d.at(7);
      await d.clearHighlights();
      await d.highlight('#gpu-canvas', 'It works');
    },
  },

  // src/ui/deviceCheckBoot.js (desktop branch), src/ui/StatusBar.js (render
  // button), docs/quickstart-web.md - Need Help
  {
    id: 'nothing-renders',
    title: 'If nothing renders',
    say: `If nothing renders, look for this screen: WebGPU Not Available.
      It means your graphics card or driver couldn't give Rhizomium a WebGPU device.
      Update your graphics driver, install the latest Windows updates, and restart Rhizomium.
      If the editor opens but the preview stays dark, check the status bar.
      Renders off means rendering was stopped, so click it to resume.
      No GPU means the graphics device never started, so go back to the driver steps.
      And if rendering is live but the preview is black, make sure something is wired into the Output node, because only what reaches the Output is drawn.`,
    async run(d) {
      await d.clearHighlights();
      await d.page.evaluate((w) => {
        document.getElementById('warning-title').textContent = w.title;
        document.getElementById('warning-message').textContent = w.message;
        document.getElementById('warning-details').innerHTML = '';
        document.getElementById('warning-solutions').innerHTML = w.solutions;
        document.getElementById('device-warning-overlay').classList.add('show');
      }, NO_WEBGPU).catch(() => {});
      await d.at(2);
      await d.highlight('#warning-solutions', 'Fix');
      await d.at(3);
      await d.clearHighlights();
      await d.click('#warning-dismiss', { settle: 600 });
      await d.highlight('.rz-sb-render', 'Status');
      await d.at(4);
      await d.clearHighlights();
      await d.click('.rz-sb-render', { settle: 600 });
      await d.highlight('.rz-sb-render', 'Renders off');
      await d.wait(2);
      await d.clearHighlights();
      await d.click('.rz-sb-render', { settle: 600 });
      await d.highlight('.rz-sb-render', 'Live again');
      await d.at(6);
      await d.clearHighlights();
      const out = await d.node('OutputFinal');
      if (out) await d.highlight(await d.nodeRect(out.id, 200), 'Output');
    },
  },

  {
    id: 'next',
    title: 'Next steps',
    say: `That's it: Rhizomium is installed and rendering.
      Next, the Quick Start guide walks you through building your first graph from scratch.
      Still stuck?
      Open an issue on the GitHub page with your Windows version, your graphics card, and what you see on screen.`,
    async run(d) {
      await d.clearHighlights();
      await d.at(1);
      await d.card(`<h1>You're set up</h1><p>Next: the Quick Start guide <span class="accent">·</span> your first graph</p>`);
      await d.at(2);
      await d.card(card('Still stuck?', [
        'Open an issue at <code>github.com/Amirashkan/rhizomium/issues</code>',
        'Include your Windows version, GPU, and what you see',
      ]));
    },
  },
];
