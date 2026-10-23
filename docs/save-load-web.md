# Saving Your Work

Learn how to save, open and manage your Rhizomium projects.

---

## Quick Save

**Keyboard Shortcut**: `Ctrl+S`

**Menu**: **File → Save**

The first time you save a project, Rhizomium asks where to put it. After that,
`Ctrl+S` writes straight back to the same file.

---

## How It Works

### Projects are files

A Rhizomium project is a `.rz` file on your disk, saved wherever you choose:

- **Yours** - An ordinary file you can copy, back up, email or put in Git
- **Private** - Stays on your computer unless you publish it
- **No account needed** - Saving and opening work offline

### What Gets Saved

A `.rz` file holds the whole project:
- All nodes, their positions and their connections
- All parameter values and expressions
- Timeline keyframes and MIDI bindings
- The VJ set (scenes, presets and playlist) and the VJ audio list
- Project name and metadata

### Media is saved by path

Images, videos, audio clips and fonts are not copied into the `.rz` file. The
project records **where each file is on your disk** and reads it from there when
you open the project. This keeps project files small and lets you use videos of
any size. Autosaves and backups work the same way.

Fonts installed on your system, and media with no known file location, are still
stored in the project.

Because the media stays where it is, **moving or renaming a media file breaks
the link**. See [Missing media](#missing-media) below.

### Autosave and backups

Separately from your project file, Rhizomium keeps a safety net:

- **Autosave** - Your current work is snapshotted about every 30 seconds while
  you edit. If Rhizomium closes unexpectedly, the welcome dialog offers
  **Continue Last Session** the next time it starts.
- **Backups** - The last 10 automatic backups are listed under
  **File → Backups** (`Ctrl+B`), where you can restore one.

These live in Rhizomium's own app data, not next to your project. They are a
safety net, not a substitute for saving.

---

## Saving Projects

### Save

1. Build your visual in the editor
2. Choose **File → Save** or press `Ctrl+S`
3. The first time, pick a folder and a file name
4. Later saves overwrite that file without asking

### Save As

**File → Save As…** (`Ctrl+Shift+S`) always asks for a location and name.
Use it to make a copy or a new version (`my_visual_v2.rz`); from then on,
`Ctrl+S` saves to the new file.

---

## Opening Projects

### Open

1. Choose **File → Open Project…** (`Ctrl+O`)
2. Pick a `.rz` file (older `.json` projects open too)

You'll be warned first if the current graph has unsaved changes.

### Drag and Drop

Drag a `.rz` or `.json` project file onto the canvas and it loads immediately.
This is the quickest way to reopen a patch you downloaded from a gallery
artwork.

### Double-click

Double-click a `.rz` file in File Explorer — Rhizomium is registered as its
handler.

---

## Best Practices

### 1. Save Frequently

Don't lose work - press `Ctrl+S` every few minutes:
- After creating something you like
- Before making major changes
- Before closing Rhizomium

### 2. Use Descriptive Names

Good: `audio_reactive_circles_v2.rz`
Bad: `project1.rz`

### 3. Keep Copies of Important Work

Project files are only as safe as the disk they're on. Keep copies of the ones
you care about in cloud storage (Dropbox, Google Drive) or in Git.

### 4. Version Your Work

Use **Save As** to keep multiple versions:
- `my_visual_v1.rz`
- `my_visual_v2.rz`
- `my_visual_final.rz`

---

## Troubleshooting

### "Save failed"

The status bar shows the reason. Most often the folder is read-only or the file
was moved; choose **File → Save As…** and pick another location.

### "Project disappeared"

- Look where you saved it - **File → Open Project…** usually opens in the last
  folder you used
- Check the Recycle Bin
- If it was never saved, open **File → Backups** and restore the latest backup

### "Can't load project"

**Cause**: Corrupted file or a project from a newer version of Rhizomium

**Solutions**:
1. Update Rhizomium to the latest release
2. Try a copy you kept elsewhere, or restore from **File → Backups**

Projects saved by v0.9.0-beta.2 or later don't open in beta.1.

### Missing media

If a project uses an image, video, audio file or font that has moved, the
project still opens, and a **Missing media** dialog lists each missing file,
its last known path and the nodes that use it:

- **Locate…** - point at the file for one row
- **Search folder…** - pick a folder; every missing file found in it is
  relinked. Files with the same name in different folders are told apart.
- **Close** - skip for now. The nodes stay empty, but the references are kept,
  so the next save still names the original files.

---

## Sharing Projects

### Share with Others

1. Save your project
2. Share the `.rz` file via:
   - Email attachment
   - Cloud storage link
   - Direct file transfer
3. The recipient opens it with **File → Open Project…** or drags it onto the canvas

If the project uses images, videos, audio or custom fonts, send those files
too, because the `.rz` file only records their paths. The recipient opens the
project, then uses **Search folder…** in the
[Missing media](#missing-media) dialog to point at the folder they saved them
to. A patch [published to the gallery](#publishing-a-patch-to-the-gallery)
carries its textures inside it.

### Collaborate

- Share `.rz` files back and forth
- Use version numbers to track changes
- Consider using Git for version control

---

## Publishing a Patch to the Gallery

**File → Publish Image…** and **File → Publish Animation…** upload your render
to the TenderWorld gallery. Alongside the image or video, Rhizomium attaches
the **patch** — a `.rz` copy of the graph that produced it.

Visitors to your artwork page get a **Download Rhizomium Patch** button. Anyone
who downloads it can open the patch here and re-render, tweak or build on your
work.

### What travels with a patch

- The full node graph, connections and parameter values
- Timeline keyframes and MIDI bindings
- The output format (composition size and sim quality)
- Textures, **embedded in the file** — so the patch opens on a machine that has
  never seen your source images

Removed before upload: wall-clock timestamps, your platform details, and anything that looks like a credential or a path on your machine.

### Patches are public

> **Anyone who can see your artwork page can download the patch.** That is the
> point of the feature — but treat a published patch as published source. If a
> graph contains something you would not hand to a stranger, don't publish it.

### Patch too large?

Patches are capped at **5 MB**, and textures dominate the size because they are
embedded. If Rhizomium warns you before uploading, use smaller source images in
your Texture nodes or remove textures the graph no longer uses. You can also
publish the artwork without the patch.

### If the gallery can't store the patch

The artwork publishes anyway. If the gallery rejects the patch — most often
because its patch storage has not been set up yet — Rhizomium re-uploads the
render on its own and tells you the patch was left off. You never lose a
finished render to a patch problem.

### Opening a patch from a newer Rhizomium

A patch created by a newer build than yours will not open — Rhizomium tells you
to update rather than loading it half-way. Updating fixes it.

---

## Privacy

Projects you save are **private by default**:
- Stored only on your computer, where you saved them
- Not sent to any server
- Not accessible to anyone else

The one exception is **publishing**: when you publish to the gallery, both the
render and the attached patch become public. Nothing leaves your computer until
you choose to publish.

---

## Next Steps

- **[Quick Start](quickstart-web.md)** - Create something to save!
- **[Your First Graph](guide.md)** - Build a project
- **[FAQ](faq-web.md)** - More questions answered

---

_Save early, save often, and keep copies of your best work!_
