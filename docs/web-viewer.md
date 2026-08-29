# Web Patch Viewer

A published patch, running live in a browser, with no editor around it —
`/viewer`. It is where a link to your work leads: the graph is compiled and
rendered on the visitor's own GPU rather than shown as a still or a video.

The viewer is part of **Cloude**, the first paid tier. Free accounts and
signed-out visitors are shown an upsell instead of a render.

---

## Opening a patch

| URL | What it opens |
|---|---|
| `/viewer?patch=<url>` | A `.rz` patch published to the gallery |
| `/viewer?handoff=<id>` | The patch the editor on this machine just handed over |
| `/viewer` | Nothing yet — drop a `.rz` file on the page, or pick one |

`?title=` sets the name in the browser tab.

### From the editor

**File → Open in Web Viewer** (`Ctrl/⌘+Shift+W`) opens the patch you are
working on in a second tab, exactly as a visitor would see it — full-bleed, no
panels, running from the published document rather than from live editor state.

The patch never leaves the machine: it goes through IndexedDB, not through the
gallery. Looking at your own work should not mean publishing it first. The
handed-over copy stays readable for 24 hours, so reloading the viewer tab works;
after that the link is dead and the editor has to send it again.

The entry is **disabled**, not hidden, in the desktop app, whose WebView blocks
`window.open()` outright and whose bundle does not carry the viewer page at all.
It used to be removed from the menu, and an absent entry reads as a feature that
does not exist — there is no way to tell "not here" from "not built". Hovering it
says which, and points at **View → Open Output**, the desktop equivalent.

**File → Web Viewer Controls…** (`Ctrl/⌘+Alt+V`) is next to it, and stays
enabled everywhere — see below.

### Which URLs the viewer will fetch

Only the gallery and the viewer's own origin. A `?patch=` value is
attacker-controlled by construction — a viewer link is a thing strangers send
you — so following it anywhere would turn every shared link into a way to aim a
visitor's browser at an arbitrary host. Off-allowlist links are refused by name
rather than silently.

The same rule runs one level down: a patch's textures and videos are loaded only
from the inline `data:` URLs that make a patch self-contained, never from a URL
the patch's author chose (`src/core/patchTextures.js`).

If a genuine gallery link is refused with "The viewer only opens patches
published to the gallery", the gallery is serving patches from a storage bucket
on another host: add that origin to `ALLOWED_PATCH_ORIGINS` in
`src/viewer/patchSource.js`.

---

## What the viewer plays, and what it cannot

It runs the same code the editor renders with — the WGSL codegen, the GPU
renderer, the compute pipeline — so a patch looks the way it looked when it was
made, at the composition size it was authored at, scaled to the window.

Per-frame CPU state comes along too: Trigger pulses, Wave sync, the Hold latch,
the Count counter, feedback and video resets, live Text. A patch built on those
plays correctly rather than freezing on its first frame.

Three things cannot follow a patch onto the web, and the page says so under the
render rather than leaving a visitor guessing:

- **Audio.** A patch carries its graph and its textures, not the track it was
  made to, so audio-reactive parameters read zero.
- **MIDI and OSC.** The bindings are saved; the hardware is not there.
- **3D field visualisers.** `ComputeFieldMapper` renders through the editor's 3D
  scene, which the viewer does not load.

`Esc`-free controls: **F** or double-click toggles fullscreen.

---

## Controls: the knobs a patch hands its visitor

A patch normally plays and that is all. Sometimes the work is not the frame but
the range — a piece worth turning a knob on. **File → Web Viewer Controls…**
(`Ctrl/⌘+Alt+V`) is where an artist says which knobs.

Nothing is offered unless it is put there, so a patch with no controls shows no
panel and behaves exactly as every patch published before this existed.

### Setting them up

Pick a node and one of its parameters, and it appears in the list. Each row
carries what the viewer will call it and, for a slider, the range and step a
visitor may travel — the range is a composition decision ("this is interesting
between 0.2 and 0.8"), not the parameter's full span, so it is stored per
control. Rows reorder; the order is the order a visitor meets them in. Twelve
controls is the limit: past a dozen the visitor is reading a mixing desk rather
than looking at a piece.

Three kinds, decided by the parameter's own type:

| Parameter type | Control |
|---|---|
| `float`, `f32`, `int`, `slider`, `dynamic` | A slider, with a range and step |
| `bool`, `boolean` | A switch |
| `select` with more than one option | A menu of that parameter's own modes |

Everything else — a colour, a colour ramp, a font, a texture file, a block of
GLSL — is an authoring surface rather than a knob, and is not offered.

**A formula owns its parameter.** A parameter holding an expression
(`=sin(time)`) cannot be offered, and one that becomes an expression later stops
being offered. The formula is the author's, and a slider that silently replaced
it would make a worse patch, not a more interactive one. This is the rule MIDI
and OSC already follow (`src/parameters/ExternalParameterControl.js`).

### What travels, and what does not

A control names a *parameter*, not a value: it stores the node id, the parameter
name, and how to present it. The value stays in `node.params`, where the
compiler, the editor and the viewer already read it — so a control cannot drift
from the patch, and removing one changes nothing about what the patch renders.

The list saves in the project file as `viewerControls` and rides into the
published `.rz` with everything else, which is why the panel is available in the
desktop app too: a patch authored on the desktop is viewed on the web like any
other. A control whose node has been deleted is left out of the file but kept in
the panel, marked — the delete may be one Ctrl+Z away, and saving in between
should not be what makes it unrecoverable.

The viewer resolves the saved list against the graph it actually loaded, and
drops what no longer works: a node that is gone, a parameter the node kind does
not declare, a presentation that no longer matches the parameter's type, a
parameter a formula has taken over. A choice's options come from the node
definition rather than the file, so a hand-edited patch cannot offer a mode the
node does not have.

### In the viewer

The panel sits over the render and fades out when nothing is happening — the
piece is being looked at, not operated. Any pointer movement brings it back, and
**C** pins it open. **Reset** puts every control back to the value the patch was
published with.

### How a moved control reaches the GPU

Two paths, chosen by the compiler rather than by the panel:

- **A uniform write.** `NodeCompiler.getParam` registers every plain numeric
  parameter it reads as a uniform, so a new value is a four-byte buffer write and
  the next frame already shows it. This is what makes a slider a slider — the
  same path MIDI and OSC take in the editor.
- **A rebuild.** A parameter baked into the WGSL — a mode a branch is chosen by,
  a boolean an `if` is written from — has no uniform to write, so it recompiles,
  debounced. A shader module compile is measured in milliseconds and a visitor
  flipping a switch can afford one; a visitor dragging a slider cannot afford
  sixty a second.

Either way the value is written onto `node.params`, so the two paths agree and a
later rebuild carries every control the visitor has moved.

---

## The gate

`viewer.web` is checked against the gallery's `/api/entitlements` **before** the
patch is fetched — downloading someone's work and then refusing to show it would
spend the visitor's bandwidth to tell them no.

Three refusals, three different remedies:

| Situation | What the page says |
|---|---|
| Signed out | Sign in to the gallery (free, and may already be paid) |
| Free tier | This is part of Cloude, with a link to the plan |
| Gallery unreachable | Could not check your plan, with a retry |

That last row is the one that differs from the rest of the editor. Live output
(`output.ndi`, `output.multiscreen`) **allows** when the gallery cannot be
reached, because a projector at a show must not go dark over a venue's wifi. The
web viewer has no such excuse — it is a web page that has just fetched, or is
about to fetch, a patch over the network — so it refuses, like everything else
in the integration. `src/viewer/viewerGate.js` argues this at length; the two
directions are pinned against each other in `tests/viewerGate.test.js`.

**This is a licence check, not a security boundary.** The patch is public and
the page is JavaScript; anyone with devtools can run it. What the gate buys is
that the paid surface is the one the gallery links to, not that the pixels are
locked.

### Running the viewer locally

The gate reads the live entitlements from `art.tenderworld.org` with credentials,
so a build served from `localhost` or `127.0.0.1` will usually see a degraded
answer and refuse. That is the fail-closed rule doing its job, not a bug: to
exercise the viewer locally, stub `/api/entitlements` (that is what the browser
checks in `tests/`-adjacent verification do) or point the client at a gallery
that trusts the local origin.

---

## Where the code is

| File | What it does |
|---|---|
| `viewer/index.html`, `viewer/viewer.css` | The page. Its own CSP, its own styles, no editor CSS. |
| `src/viewer/viewerMain.js` | The four states: checking, locked, loading, playing. |
| `src/viewer/viewerGate.js` | The `viewer.web` check, and why it fails closed. |
| `src/viewer/patchSource.js` | Where a patch may come from; the origin allowlist. |
| `src/viewer/patchHandoff.js` | The editor's IndexedDB handoff. |
| `src/viewer/PatchRuntime.js` | Graph → WGSL → renderer → render loop, and `setControlValue`. |
| `src/viewer/ViewerControls.js` | The controls document: what may be offered, and what a saved control means. |
| `src/viewer/viewerControlsUi.js` | The panel a visitor turns the knobs with. |
| `src/ui/ViewerControlsPanel.js` | The editor panel that decides which knobs. |
| `src/ui/openInWebViewer.js` | The editor's File menu entry. |
| `src/core/graphHydration.js` | Saved records → live graph, shared with the editor. |
| `src/core/patchTextures.js` | Inline media → GPU, shared with the editor. |

The last two are shared deliberately. A viewer that rebuilt documents its own
way would drift from the editor silently, and the symptom would be a patch that
renders differently in the two places with nothing to point at.

### Routing

`/viewer` is served by all three front doors, and each needed saying so
explicitly: a rewrite in `vercel.json`, a route in `rhizo_server.py`, and a dev
middleware in `vite.config.js` (Vite falls through to the landing page for an
extensionless path it cannot resolve). The page is left out of the desktop
bundle entirely.
