# Saving Your Work

Learn how to save, load, and manage your Rhizomium projects in the browser.

---

## Quick Save

**Keyboard Shortcut**: `Ctrl+S` (Windows/Linux) or `Cmd+S` (Mac)

**Menu**: **File → Save**

Your project is saved to your browser's local storage instantly!

---

## How It Works

### Browser Storage

Rhizomium saves your projects in your browser's **Local Storage**:

- **Fast** - Instant save and load
- **Private** - Stored only on your computer
- **No account needed** - Works offline
- **Browser-specific** - Projects are tied to your browser
- **Limited space** - Usually 5-10MB per site

### What Gets Saved

When you save, Rhizomium stores:
- All nodes and their positions
- All connections between nodes
- All parameter values
- Project name and metadata

### What Doesn't Get Saved

- Undo/redo history
- Canvas zoom and position (resets on load)
- Audio settings (resets on load)

---

## Saving Projects

### Creating a New Save

1. Build your visual in the editor
2. Click **Save** button or press `Ctrl+S`
3. Enter a project name when prompted
4. Click **Save**

Your project is now saved!

### Updating an Existing Project

1. Make changes to your visual
2. Click **Save** or press `Ctrl+S`
3. Choose to **overwrite** existing or **save as new**

---

## Loading Projects

### Load Menu

1. Choose **File → Open Project…**
2. Browse your saved projects
3. Click a project name to load it

### What Happens

- Current graph is cleared (you'll be warned if unsaved)
- Saved project is restored
- All nodes and parameters are restored
- Canvas view resets to default

---

## Managing Projects

### Renaming Projects

Most versions support renaming in the Load menu:
1. Open Load menu
2. Right-click project name (if supported)
3. Choose "Rename"

Or save with a new name to create a copy.

### Deleting Projects

1. Open Load menu
2. Find the project you want to delete
3. Click the **delete/trash icon** next to it
4. Confirm deletion

**Warning**: Deleted projects cannot be recovered!

---

## Exporting Projects

### Download as JSON

To backup or share your project:

1. **Method A** - Export Button:
   - Choose **File → Export**
   - Choose save location
   - Project downloads as `.json` file

2. **Method B** - Console Export:
   - Press `F12` to open console
   - Find your project in Application → Local Storage
   - Copy the JSON data
   - Save to a text file with `.json` extension

### Why Export?

- **Backup** - Protect against browser data loss
- **Sharing** - Send projects to friends
- **Migration** - Move projects to another browser/computer
- **Version Control** - Track changes with Git

---

## Importing Projects

### Upload JSON File

1. Choose **File → Open Project…**
2. Select a `.json` file from your computer
3. Project loads immediately

### Drag and Drop

Drag a `.rz` or `.json` project file onto the canvas and it loads immediately.
This is the quickest way to reopen a patch you downloaded from a gallery
artwork.

On the desktop build you can also double-click a `.rz` file in your file
browser — Rhizomium is registered as its handler.

---

## Best Practices

### 1. Save Frequently

Don't lose work - save every few minutes:
- After creating something you like
- Before making major changes
- Before closing the browser

### 2. Use Descriptive Names

Good: `audio_reactive_circles_v2`
Bad: `project1`

### 3. Export Important Work

Download JSON backups of projects you care about:
- Before making big changes
- After completing a project
- Monthly backups of all projects

### 4. Organize with Names

Use prefixes to organize:
- `exp_` - Experiments
- `show_` - Performance pieces
- `wip_` - Works in progress
- `final_` - Completed works

### 5. Version Your Work

Keep multiple versions:
- `my_visual_v1`
- `my_visual_v2`
- `my_visual_final`

---

## Storage Limits

### Browser Quota

Typical limits:
- **Chrome/Edge**: 5-10MB per origin
- **Firefox**: 10MB per origin
- **Safari**: 5MB per origin

### How Much Space Do Projects Use?

- Simple project: 5-20 KB
- Medium project: 20-50 KB
- Complex project: 50-200 KB

You can typically store 50-200 projects!

### Check Your Usage

Open browser console (F12):
```javascript
// Check Local Storage size
let size = 0;
for (let key in localStorage) {
  size += localStorage[key].length;
}
console.log('Storage used:', Math.round(size / 1024), 'KB');
```

---

## Data Safety

### Risks

Projects can be lost if:
- **Browser cache is cleared** - Clears all projects!
- **Incognito/Private mode** - Not saved permanently
- **Different browser** - Projects don't transfer
- **Browser uninstall** - Removes all data
- **Computer crash** - Rare, but possible

### Protect Your Work

**Export important projects** as JSON files
**Keep backups** in cloud storage (Dropbox, Google Drive)
**Don't rely solely on browser storage**
**Avoid clearing browser data** for studio.tenderworld.org

---

## Troubleshooting

### "Failed to save"

**Cause**: Browser storage is full

**Solutions**:
1. Delete old projects
2. Export and delete some projects
3. Clear other site data (carefully!)

### "Project disappeared"

**Cause**: Browser data was cleared

**Solutions**:
- Check if you exported it before
- Check browser trash/recovery
- Unfortunately, un-exported projects are gone

### "Can't load project"

**Cause**: Corrupted data or incompatible version

**Solutions**:
1. Try refreshing the page
2. Check browser console for errors
3. If you have JSON backup, try importing it

### Multiple browsers show different projects

**This is normal!** Each browser stores data separately:
- Chrome projects ≠ Edge projects
- Regular mode ≠ Incognito mode

Export projects to share between browsers.

---

## Sharing Projects

### Share with Others

1. Export your project as JSON
2. Share the file via:
   - Email attachment
   - GitHub Gist
   - Cloud storage link
   - Direct file transfer

3. Recipient imports the JSON file

### Collaborate

- Share JSON files back and forth
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

Removed before upload: wall-clock timestamps, your browser and platform
details, and anything that looks like a credential or a path on your machine.

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
- Stored only in your browser
- Not sent to any server
- Not accessible to anyone else
- Not tracked or analyzed

The one exception is **publishing**: when you publish to the gallery, both the
render and the attached patch become public. Nothing leaves your browser until
you choose to publish.

---

## Next Steps

- **[Quick Start](quickstart-web.md)** - Create something to save!
- **[Your First Graph](guide.md)** - Build a project
- **[FAQ](faq-web.md)** - More questions answered

---

_Save early, save often, and export your best work!_
