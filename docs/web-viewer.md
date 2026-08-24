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

The entry is hidden in the desktop app, whose WebView blocks `window.open()`
outright. **View → Second Monitor Viewer** is the desktop equivalent.

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
| `src/viewer/PatchRuntime.js` | Graph → WGSL → renderer → render loop. |
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
