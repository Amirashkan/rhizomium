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

**File → Web Viewer Tool…** (`Ctrl/⌘+Alt+V`) is next to it, and stays enabled
everywhere — see below.

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

## The Web Viewer tool

**File → Web Viewer Tool…** (`Ctrl/⌘+Alt+V`) is one window for the page a link
leads to, in the order the questions come up:

| Tab | What it answers |
|---|---|
| **Page** | What the page looks like around the render |
| **Controls** | Which parameters a visitor may move |
| **Link** | What to send, and which of the two kinds of link it is |

It edits two documents — `ViewerPageModel` and `ViewerControlsModel` — and asks
`viewerLink.js` for URLs. It holds no state of its own beyond what is being
typed and the last link produced, so closing and reopening it shows the patch as
it stands rather than as the tool last remembered it.

It stays available in the desktop app. What it edits is part of the published
document, and the link is a URL — it can be copied and sent from a machine that
cannot open it in a second tab.

---

## Page: the room the piece hangs in

| Setting | What it does |
|---|---|
| **Title** | The browser tab. Empty falls back to the project name. |
| **Ground** | The colour behind the render, wherever the composition does not reach. |
| **Framing** | **Fit** letterboxes the whole composition; **Fill** fills the window and crops the edges. |
| **Controls** | **Fade**, **Always** or **Hidden** — how the controls panel behaves. |
| **Note** | Whether the "what the viewer cannot play" line shows. |

Every one has the value the viewer always used as its default, and **a page
nobody has touched serializes to nothing**: a patch that takes the page as it
comes carries no `viewerPage` key at all, and a `.rz` saved today reads like one
saved before the setting existed.

The ground colour is **hex only** (`normalizeColor` in `ViewerPage.js`). The
value is written into the page's background, and a document that could put
arbitrary CSS there is a document that can put a `url()` in it — a beacon to
whatever host the patch's author chose, which is exactly what `patchSource.js`
and `patchTextures.js` refuse one level up.

Settings travel in the **document**, not the URL: a link is a thing people paste
into chat clients that mangle query strings, and the gallery shows the same patch
without any link of ours around it. `?title=` is the one exception, and it
predates this — the page's own title wins over it, then the URL's, then the
patch's own.

---

## Controls: the knobs a patch hands its visitor

A patch normally plays and that is all. Sometimes the work is not the frame but
the range — a piece worth turning a knob on. The **Controls** tab is where an
artist says which knobs.

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

The Page tab's **Controls** setting chooses the starting behaviour: *Fade* is
that; *Always* starts pinned; *Hidden* shows a render and nothing else, leaving
the controls in the patch for a later edit to turn back on. *Always* is a
starting position, not a lock — **C** still works either way.

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

## Link: what to send

There are two links, and conflating them is what the **Link** tab exists to
prevent. "I sent the link and my friend got an error" is the failure a single
unlabelled Copy button produces, so each one says which it is, and a share link
is marked in the accent colour while a preview link is muted.

| | Preview | Share |
|---|---|---|
| URL | `/viewer?handoff=<id>` | `/viewer?patch=<url>` |
| Where the patch is | This browser's IndexedDB | The gallery |
| Works for | You, on this machine, for 24 hours | Anyone you send it to |
| Costs | Nothing; nothing is uploaded | An upload, and a publish |

**Make a preview link** is instant and private — it is how the page looks, not
something to send. **Publish & make a link** asks first, then uploads the patch
with a still frame of it (the pair the gallery stores — a viewer link with no
thumbnail behind it is a link to a blank card) and builds a link pointing at the
published `.rz`. If the gallery stores the media but not the patch, that is
reported as a failure rather than as a link: there would be nothing for a viewer
link to point at, and handing back the media URL would produce a link that opens
a WebP in the viewer.

**Already published?** paste the patch's address and the tool builds the link
without uploading anything. The address is held to the viewer's own allowlist
here rather than at the far end, so a wrong URL is refused while the artist can
still fix it — not by a friend who clicked it. A refusal clears the link on
screen and says why under the field; leaving the previous link sitting there is
how someone copies a preview link believing it is the share link they just asked
for.

Copying goes through the async Clipboard API, which needs a secure context and a
permission a WebView may not grant. When it fails the field is selected and the
tool says so, rather than a Copy button that silently did nothing.

### Publishing from a dev server

`npm run dev` serves the editor from `http://localhost:5173`, which is neither
of the origins the gallery answers, so a publish used to die before it left the
browser:

```
Access to XMLHttpRequest at 'https://art.tenderworld.org/api/rhizo-upload'
from origin 'http://localhost:5173' has been blocked by CORS policy
```

This was never specific to viewer links: **Publish Image** and **Publish
Animation** go through the same `uploadBlob`.

**In dev the call no longer leaves our origin.** `vite.config.js` proxies
`/gallery-api/*` to the gallery server-side, and `src/utils/galleryEndpoint.js`
is the one place that decides which URL a gallery call gets — the proxy path on
the dev server, the gallery's own origin everywhere else. That puts the hop
outside the browser and takes CORS out of the picture.

The proxy fixes reaching the gallery, not being *someone* to it. A browser at
`localhost` has no gallery cookie to send, and the proxy has no cookie jar of
its own, so a dev run authenticates with the desktop bearer token or not at all
— which is what `tauri dev` does anyway. `uploadBlob` sends that token; it used
to send no headers at all, so even an installed, paired desktop app could read
its entitlements and then fail to publish.

An **installed** desktop app calls the gallery directly and has no proxy, so it
needs the gallery itself to allow `tauri://localhost` and read the
`Authorization` header. See `TENDERWORLD_API_INTEGRATION.md` for that contract.

So, from a plain `npm run dev` in a browser:

- **Preview links work.** They touch no network at all.
- **Everything else in the tool works** — the page, the controls, pasting an
  already-published patch address to build a share link.
- **Publishing needs a credential**: `tauri dev` with a paired token, or the
  deployed studio.

An upload that never left the browser is reported as one. XHR cannot tell a
refused preflight from a dead network — an `error` event, status 0, no body,
with the reason in the console only — so the editor names both and names the
origin (`UploadBlockedError` in `src/ui/publish.js`). It is never retried
without the patch the way a gallery-side patch failure is: a request the
browser never sent was not refused over its contents.

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
| `src/viewer/ViewerPage.js` | The page document: title, ground, framing, apparatus. |
| `src/viewer/viewerControlsUi.js` | The panel a visitor turns the knobs with. |
| `src/ui/WebViewerTool.js` | The editor's Page / Controls / Link window. |
| `src/ui/viewerLink.js` | The two links, and the refusal to confuse them. |
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
