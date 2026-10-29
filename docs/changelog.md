# Changelog

What changed in each Rhizomium release, newest first. Downloads for every
version are on the [GitHub releases page](https://github.com/Amirashkan/rhizomium/releases).

Rhizomium is in beta, so a release can change how a project file is saved.
When one does, its entry says so under **Project files**.

---

## Unreleased

### Changed

- **OSC, NDI and Live Input are built into the desktop app.** There are no
  bridges to run any more: the app switches each one on the first time a patch
  uses it (OSC when a patch has OSC bindings or learn starts, NDI when output
  is turned on or a Live Input has a source) and lets go of the network when
  nothing does. NDI output and Live Input are one NDI feature on one local
  port (8767). If the NDI Runtime is missing, the app offers the download and
  picks it up without a restart.

### Removed

- `osc_bridge_server.py`, `ndi_bridge_server.py`, `video_in_bridge_server.py`
  and the `npm run osc` / `ndi` / `video-in` scripts. Programs that push
  frames to Live Input now send to `127.0.0.1:8767` instead of `8769`.

### Fixed

- OSC in the installed Windows app failed with "Could not reach the OSC bridge
  at ws://tauri.localhost:8767/ws".

---

## v0.9.0-beta.9

*October 29, 2026*

### Added

- **Live Input node** (Texture → Live Input) brings frames in from
  TouchDesigner, OBS, Resolume, any NDI source, or anything that pushes
  JPEG/PNG/raw RGBA frames over a WebSocket or HTTP POST. Frames arrive
  through the new Video In bridge (`npm run video-in`, port 8769) and sample
  like a Texture 2D, with stretch, contain or cover fit. The new
  [External input](external-input.md) page covers it alongside OSC, with
  TouchDesigner recipes.

### Changed

- **The OSC, NDI and Video In bridges are desktop-app only.** On the web the
  OSC panel says so and disables Connect, the NDI menu entry is hidden, and
  the Live Input node reads "desktop app only".

---

## v0.9.0-beta.8

*October 29, 2026*

### Changed

- **Rust orange replaces lime as the accent colour.** Selection, primary
  buttons, the playhead, focus rings, live indicators and every panel that
  used lime now use rust orange (`#d9733f`).
- The landing page's second colour is now a warm neutral instead of olive.

### Notes

- Tutorial videos are temporarily unavailable.

---

## v0.9.0-beta.7

*October 28, 2026*

### New

- **Patch with the keyboard or a screen reader.** The patch canvas is now a
  navigable tree of nodes, each opening onto its inputs, outputs and
  parameters. C…C connects, X disconnects, M moves, N adds a node, Enter
  follows a wire or opens the parameters, G goes to a node by name and
  Shift+F10 opens the node menu. F10 walks the menu bar, and Connect /
  Disconnect Pins are proper dialogs.
- **Help > Describe Patch** lays the whole patch out as headings and lists,
  and can copy it as text. Results of actions are announced to screen readers.
- **Edit > Accessibility** opens a new Preferences section: contrast
  (standard, high, maximum), interface size from 100% to 200%, a bold focus
  ring, reduced interface animation, announcement verbosity and outline order.
- **Flashing and motion warnings.** With warnings on, an opened patch is held
  on its first frame and checked against WCAG 2.3.1. The warning offers Keep
  Paused, a slower safe speed, or Play Anyway. **Tools > Check Flashing &
  Motion** runs the check on demand and **View > Pause Preview** stops the
  preview clock. VJ scene changes are never interrupted.
- **Colour vision preview** simulates or corrects for seven colour vision
  profiles across the preview, thumbnails, 3D view and popped-out preview.
  Exports keep their real colours.

### Fixed

- Returning to the patch canvas resumes on the node last selected with the
  mouse instead of an older keyboard position.
- Nodes scrolled into view are no longer hidden under the status bar or key
  hint, and at larger interface sizes the status bar readouts no longer run
  into each other.

### Docs

- New [Accessibility](accessibility.md) page; shortcuts and interface pages
  cover the new keys and menus.

---

## v0.9.0-beta.6

*October 26, 2026*

### New

- **Timeline Record mode.** Arm Record and every change you make to a number
  on the open node, or to a parameter that already has keyframes, becomes a
  keyframe while the timeline plays. The playhead keeps moving while you drag.
  Right-click a keyframe diamond to change its interpolation or delete it, and
  lanes now draw the eased curve.
- **Choose where exports are saved.** The Export panel has a **Save to** field
  with a **Choose…** button. On desktop the folder is remembered across
  restarts. Existing files are never overwritten (a clash gets a numbered
  name), and if the folder can't be written the export is downloaded instead.
- Local exports no longer have a length limit. **Stop & Save** still ends a
  recording early.
- Publishing budgets videos at 500 MB (was 50 MB), and long videos now
  upload reliably, resuming after a dropped connection.

### Fixed

- The `audioEnvelopeBass`, `Mids`, `Highs` and `Full` variables read the
  Audio panel's Low / Mid / High / Level meters, so they pulse with the music
  instead of sitting at 1.0. The Audio node's Attack, Release and Gain apply
  to them.
- The Export panel sees the track loaded in the Audio panel and records it,
  and the export size opens at the Output Format from Preview / Export Settings.
- The Compute Profiler measures real GPU time per node instead of reading
  ~0 ms for everything. Its overlay and docs list the shortcuts the editor
  actually binds (Ctrl+Alt+P and Ctrl+Alt+Shift+…).
- The installed app's "no GPU device" screen no longer tells you to update
  Chrome.

### Docs

- Reference entries for Audio, Audio Value, Audio Sampler, Wave, the logic
  gates, Text and Projection Map; more on desktop project files, relinking
  missing media and VJ Control.
- Pages for systems that no longer exist are gone, and setup is rewritten
  around the desktop app.

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
