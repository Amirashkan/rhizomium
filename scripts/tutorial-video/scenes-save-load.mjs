// Saving and loading .rz projects: Save and Save As, opening, how media is
// kept, autosave and backups. Two to three minutes.
//
//   node scripts/tutorial-video/make.mjs --scenes scripts/tutorial-video/scenes-save-load.mjs --out scripts/tutorial-video/build/04save-load
//
// Same format as scenes.mjs. Narration follows docs/save-load-web.md and the
// code behind it: the desktop project file names media by path
// (src/core/mediaRefs.js), autosave snapshots every 30 s and an automatic
// backup is taken every 10 minutes, plus one at startup when there is a session
// to protect (SaveLoadManager.js, WelcomeWindow.js); the last 10 are kept.
//
// The recording runs in the browser build, where Save and Open bring up the
// system's file dialogs, which a screencast can't see; those menu items are
// pointed at, never clicked. The Missing media dialog only appears on the
// desktop, so it is opened directly with two example files.
//
// The Texture 2D image is MEDIA below; any picture will do.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MEDIA = process.env.SAVE_LOAD_IMAGE || join(HERE, 'build/04save-load/media/cells.jpg');
if (!existsSync(MEDIA)) throw new Error(`scenes-save-load: no image at ${MEDIA} (set SAVE_LOAD_IMAGE)`);

export const title = 'Rhizomium: saving and loading projects';
export const name = 'rhizomium-save-load';

export const lexicon = {
  '.rz': 'dot R Z',
  MIDI: 'middy',
};

// What the Missing media dialog lists in the demonstration.
const EXAMPLE_MISSING = [
  { kind: 'texture', ref: { path: 'C:\\Users\\you\\Pictures\\cells.jpg', name: 'cells.jpg' }, entry: { isVideo: false } },
  { kind: 'texture', ref: { path: 'D:\\Footage\\waves.mp4', name: 'waves.mp4' }, entry: { isVideo: true } },
];

const BLANK = { x: 1500, y: 280 }; // empty canvas, right of the preview window

/** Point at a File menu entry with a label. */
async function pointAt(d, selector, label) {
  await d.clearHighlights();
  await d.safe(`point at ${selector}`, () => d.move(selector));
  await d.highlight(selector, label);
}

export default [
  {
    id: 'intro',
    title: 'Saving and loading',
    chapter: false,
    say: `This video covers saving and opening projects, how images and videos are kept, and the autosave and backups that catch your work.`,
    async run(d) {
      await d.card(`<h1>Saving and loading</h1><p>Rhizomium <span class="accent">·</span> .rz projects, media, autosave and backups</p>`);
      await d.safe('new graph', async () => {
        const start = d.page.getByText('Start New Graph').first();
        if (await start.isVisible()) await start.click();
      });
      await d.at(0, 6);
      await d.card('');
    },
  },

  // docs/save-load-web.md - Quick Save, Projects are files, What Gets Saved, Opening Projects
  {
    id: 'save-open',
    title: 'Save and open',
    say: `A Rhizomium project is a single .rz file, saved wherever you choose.
      File, Save, or Control S, asks for a folder and a name the first time, and after that writes straight back to the same file.
      Save As, Control Shift S, always asks, so use it to keep versions: version two, version three, final.
      To open a project, use Open Project, Control O, drag a .rz file onto the canvas, or double-click it in File Explorer.
      The file holds the whole project: nodes, wires, parameters, keyframes, MIDI bindings, and your VJ set.`,
    async run(d) {
      await d.at(1);
      await d.menu('File');
      await pointAt(d, '#btn-save', 'Ctrl+S');
      await d.at(2);
      await pointAt(d, '#btn-save-as', 'Ctrl+Shift+S');
      await d.at(3);
      await pointAt(d, '#btn-open-project', 'Ctrl+O');
      await d.at(4);
      await d.clearHighlights();
      await d.closeMenus();
      await d.move(BLANK);
    },
  },

  // docs/save-load-web.md - Media is saved by path, Missing media, Share with Others
  {
    id: 'media',
    title: 'Images and videos',
    say: `Images and videos work differently.
      Add a Texture 2D node, and drop a picture or a video into its parameter panel.
      The project doesn't copy that file: it records where the file is on your disk, and reads it from there each time the project opens.
      That keeps project files small, but moving or renaming a media file breaks the link.
      When that happens, the project still opens, and a Missing media dialog lists each file, where it used to be, and what uses it.
      Locate points at one file, and Search folder relinks every missing file it finds in a folder you pick.
      Close skips it for now; the references are kept, so the next save still names the original files.
      And when you send a project to someone, send its media files along with it.`,
    async run(d) {
      await d.at(1);
      const tex = await d.addNode('texture 2d', { x: 1000, y: 820 });
      await d.openParams(tex);
      await d.safe('drop image', async () => {
        const zone = d.page.locator('.parameter-panel input[type=file]').first();
        const target = d.paramBlock('Image');
        await d.move(target);
        await d.wait(0.4);
        await zone.setInputFiles(MEDIA);
      });
      await d.wait(1.2);
      // Into the Output, in place of the starter graph's Gradient.
      const out = (await d.node('OutputFinal'))?.id;
      if (tex && out) await d.wire(tex, 0, out, 0);
      await d.click(BLANK, { settle: 400 });
      await d.at(2);
      if (tex) await d.highlight(await d.nodeRect(tex, 200), 'Stored as a path');
      await d.at(3);
      await d.clearHighlights();
      await d.at(4);
      // Fire and forget: the dialog's promise resolves only when it closes.
      await d.page.evaluate((missing) => {
        import('/src/ui/MissingMediaDialog.js').then(({ showMissingMediaDialog }) => showMissingMediaDialog({
          missing,
          onLocate: async () => false,
          onSearchFolder: async () => null,
        }));
      }, EXAMPLE_MISSING).catch(() => {});
      await d.wait(1);
      await d.at(5);
      const dialog = d.page.locator('.missing-media').first();
      await d.highlight(dialog.locator('button', { hasText: 'Locate' }).first(), 'One file');
      await d.wait(2.5);
      await d.clearHighlights();
      await d.highlight(d.page.getByRole('button', { name: 'Search folder…' }).first(), 'A whole folder');
      await d.at(6);
      await d.clearHighlights();
      await d.click(d.page.getByRole('button', { name: 'Close', exact: true }).last(), { settle: 600 });
    },
  },

  // docs/save-load-web.md - Autosave and backups; SaveLoadManager autosave
  {
    id: 'autosave',
    title: 'Autosave',
    say: `Separately from your files, Rhizomium keeps a safety net.
      While you work, it snapshots the project about every thirty seconds.
      If it ever closes unexpectedly, the welcome screen offers Continue Last Session the next time it starts.
      You can bring that screen up any time from Help, Welcome.`,
    async run(d) {
      // The snapshot the timer would take within 30 s, taken now so the
      // welcome screen has one to offer.
      await d.page.evaluate(async () => {
        const m = window.saveLoadManager;
        m.hasUnsavedChanges = true;
        await m._runAutoSave();
      }).catch(() => {});
      await d.at(2);
      await d.menu('Help', 'Welcome');
      await d.wait(1);
      await d.highlight(d.page.getByText('Continue Last Session').first(), 'Your last session');
      await d.at(3, 3);
      await d.clearHighlights();
      await d.key('Escape', 700);
    },
  },

  // docs/save-load-web.md - Autosave and backups; BackupDialog.js
  {
    id: 'backups',
    title: 'Backups',
    say: `For older versions, open File, Backups, or Control B.
      A backup is taken every ten minutes while you work, and when the editor starts with a previous session to protect, and the last ten are kept.
      Create Backup adds one right now, before you try something drastic.
      Each backup can be restored, exported as a file, or deleted.
      They live in Rhizomium's own app data, not next to your project: a safety net, not a replacement for saving.`,
    async run(d) {
      await d.menu('File', 'Backups');
      await d.wait(0.8);
      await d.at(1);
      await d.highlight('.backup-list-container', 'Last ten');
      await d.at(2);
      await d.clearHighlights();
      await d.click('#backup-create-btn', { settle: 1200 });
      await d.at(3);
      await d.highlight(d.page.locator('.backup-item').first(), 'Restore · export · delete');
      await d.at(4);
      await d.clearHighlights();
      await d.closeWindow('.backup-dialog');
    },
  },

  {
    id: 'outro',
    title: 'Next steps',
    say: `So: save with Control S, keep versions with Save As, relink media when it moves, and let autosave and backups catch the rest.
      Save early, and save often.`,
    async run(d) {
      await d.at(1);
      await d.card(`<h1>Save early, save often</h1><p>Ctrl+S <span class="accent">·</span> Save As for versions <span class="accent">·</span> File → Backups</p>`);
    },
  },
];
