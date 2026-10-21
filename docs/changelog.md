# Changelog

What changed in each Rhizomium release, newest first. Downloads for every
version are on the [GitHub releases page](https://github.com/Amirashkan/rhizomium/releases).

Rhizomium is in beta, so a release can change how a project file is saved.
When one does, its entry says so under **Project files**.

---

## v0.9.0-beta.5

*October 21, 2026*

### Fixed

- **Desktop:** signing in works. Sign in now opens a Rhizomium window that
  shows a pairing code, copies it and opens the gallery in your own browser,
  where you are already signed in. Approve there and the window stores the
  sign-in and closes. "Manage on the gallery" opens in your browser too.
- The Account dialog shows your real account while AI debug mode is on,
  instead of "Not signed in", and says when debug mode is on.

---

## v0.9.0-beta.4

*October 21, 2026*

### New

- **Alt+drag numbers in the Custom GLSL code editor.** Hold Alt and drag a
  number left or right to scrub it, and watch the output change as you go.
  The shader is not recompiled on every step, so the drag stays smooth, and
  this works for unsuffixed integers as well as floats.
- **New example patch: Bulb Nebula.**

### Fixed

- `for` loops now compile in Custom GLSL.
- A canvas pan ends as soon as the mouse button is released, even if the
  editor missed the button-up.
- **Desktop:** the editor window reopens where you closed it.

---

## v0.9.0-beta.3

*October 21, 2026*

### Fixed

- **Desktop:** in the installed app, the add-node palette (right-click or
  **Create Node**) was invisible, and the close button did nothing because the
  unsaved-changes dialog it waits on was hidden too. Both now show.

---

## v0.9.0-beta.2

*October 21, 2026*

### New

- **Starter patches on the welcome screen.** Three finished patches (Aurora
  Field, Mirror Cells and Dot Bloom) open with one click and render right
  away, so a first launch no longer starts on an empty canvas.
- **Unsaved-changes warning.** Closing the app with unsaved edits now asks
  before discarding them.
- **Audio Sampler node.** Plays an audio file when its scene starts and stops
  when the scene leaves. Loop, Volume and Speed accept
  [expressions](parameter-expressions.md).
- **VJ panel**
  - Scenes, presets and playlist rows have a right-click (and ⋯) menu to
    rename, duplicate, remove and move them, and all three lists reorder by
    dragging.
  - **Override** writes the editor's current state into a scene. Each scene
    also has an **Auto** toggle: while that scene is live, your edits are saved
    back into it.
  - A new **Audio** tab keeps a list of audio files to load and play. Files
    can be added with the picker or dropped onto the tab.
  - **Narration from Folder…** in the Playlist tab reads a show's narration
    and writes it into the Text nodes of the matching scenes, after showing
    you what will change.
  - The VJ set and the audio playlist are saved in the project file, and
    scenes are kept in browser storage as you go.
- **Pop out the preview (browser).** The floating preview has a **Pop out**
  button that moves the live output into its own window. It keeps animating
  while the editor tab is hidden.
- **Second monitor (desktop).** Video graphs and 3D Field Visualizers render
  natively on the second monitor, and the output stays open and lit across
  scene switches.

### Changed

- The render canvas is sized from the output format, not from the editor
  window, and the editor output renders without MSAA.
- Text node textures are sized to the output instead of a fixed 1024 square,
  so text stays sharp at high resolutions.

### Fixed

- Timeline playback reaches keyframes past the first 10 seconds.
- **Ctrl+Shift+V** opens the VJ Control panel again.
- A fragment node inside a compute feedback loop no longer renders black.
- Compute nodes keep running while the graph rebuilds.
- An error in one frame no longer stops the render loop.
- A VJ set can no longer be lost when it is replaced, and lost scenes are
  rebuilt from the editor's autosave snapshots.
- Starting a new project empties the VJ set.
- **Second monitor:** it rebuilds when a compute node's shader changes,
  receives the right pin count for nodes with dynamic inputs, no longer leaks
  a texture on every update, and no longer overwrites Text textures.

### Project files

- **Desktop:** project files, autosaves and backups refer to images, videos,
  audio, fonts and VJ audio tracks **by file path** instead of embedding them.
  Projects are much smaller, and videos over 24 MB can now be saved.
- If a referenced file has moved, the project still opens. A relink dialog
  lists each missing file and where it is used. **Locate** points at it
  directly; **Search folder** finds it, and tells same-named files in
  different folders apart.
- The save format moved from version 9 to 10. Projects saved by beta.2 or
  later do not open in beta.1.
- The browser build saves exactly as before.

---

## v0.9.0-beta.1

*September 7, 2026*

The first public beta, with a Windows desktop build alongside the web
studio. It includes:

- A visual node editor with 130+ nodes in 12 categories and a real-time
  WebGPU preview. See the [node reference](node-reference.md).
- [Custom GLSL](nodes.md) nodes, and Shader Tools under **Tools**.
- [Parameter expressions](parameter-expressions.md) driven by time, audio
  and the mouse.
- A [timeline with keyframes](timeline.md).
- [MIDI](midi.md) mapping, OSC messaging and [audio reactivity](audio-web.md).
- [Compute nodes](compute-nodes.md) for GPU particle systems and simulations.
- [3D field visualization](field-visualization.md).
- [Multi-screen output](multi-screen.md) and the
  [web patch viewer](web-viewer.md).
- Floating, resizable panels, with saved layouts in the **Window** menu.
- A built-in [performance profiler](profiler.md).
