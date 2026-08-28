# Multi-Screen Output

Drive several displays from one patch, each showing its own part of the
composition — a projector panorama, a video wall, or a stage rig where every
surface gets its own slice.

Multi-screen output is part of **Cloude Plus**, and it runs in the **desktop
app**: a screen is a real, borderless, fullscreen OS window placed on a chosen
display, which the browser cannot open.

---

## The idea in one paragraph

Every screen renders the **same composition**. What differs is the **region** —
the crop of the composition that screen shows. A single mirrored output is the
full region; three projectors across a wall are three thirds. The editor
broadcasts the composition's state (the shader, the uniforms, the compute graph)
**once**, and each output window re-renders it and presents its own part. That is
why the second and third screen cost the editor almost nothing: no pixels are
copied between windows, and no work is repeated on the editor's side.

---

## Setting up a rig

**View → Output Screens…** opens the screens panel.

1. Pick a layout: **Single**, **2 across**, **3 across**, **2 stacked**, or
   **2 × 2**. The rig is built with a screen per tile, named for its place.
   **Mirror** is the other wall — it keeps the rig you have and points every
   screen at the whole composition, so the same image goes to every projector.
2. Assign each screen a display. **Auto** takes the next display the editor is
   not on and no other screen has claimed, so "3 across" lands on three
   projectors without any picking at all.
3. **View → Open Output** (`Ctrl/⌘ + Shift + 2`) takes the whole rig live.

The layout map at the top of the panel draws the composition once with every
screen's region on it. Overlaps show as a brighter band and gaps show as bare
background, which is the quickest way to see that a wall is actually covered.

### The fields

| Field | What it does |
| --- | --- |
| **●/○** | Switches the screen on or off. Off keeps the screen in the rig without holding a window open. |
| **Name** | What the screen is called, in the panel and in its window title. |
| **Display** | Which display it opens on. `Auto` = the next free one. |
| **Resolution** | How many pixels the screen *presents* with. The render is always the output format. |
| **Region X/Y/W/H** | The part of the composition this screen shows, in percent. |

---

## Edge blending

Two projectors aimed at one wall have to overlap, and the overlap has to fade out
on both sides or the seam reads as a bright bar.

1. Set **Edge blend** in the panel before choosing a layout. At 10%, each tile
   shares a tenth of its width with its neighbour, and the tiles still cover the
   composition exactly.
2. Give each screen's surface a **soft edge** in the projection-mapping panel
   (**View → Projection Mapping**). The feather runs the fade that makes the two
   beams add back up to one continuous image.

---

## Framing and mapping together

Both a region and a projection mapping crop the composition, and they compose in
the obvious order: **the region decides what the screen shows, and the mapping
works inside it.** A surface pinned to the left half of a screen samples the left
half of that screen's region — not the left half of the whole composition — so a
mapping set up against one projector keeps meaning the same thing when the rig is
re-tiled around it.

The mapping itself is composition-wide: every screen warps through the same
surfaces, each folding in its own framing.

---

## Resolution

A screen renders the whole composition and shows a crop of it, so the render
behind a crop is **larger** than the display: a third of a composition presented
on a 1920-wide projector is rendered 5760 wide, or the crop would be a 3× upscale
of a 1920 frame. That is the honest cost of driving a wall from one machine, and
it is what keeps a panorama sharp.

The **Resolution** field caps the pixels a screen *presents* with, not what it
renders — useful when the GPU is the bottleneck. The render is letterboxed into
whatever that yields, so framing never changes with it.

Very steep crops are clamped to what the GPU will allocate (8192 px on the long
edge), scaling both axes together so the picture's shape is never squashed.

---

## Saving a rig

The screens travel with the project: displays, framing, names and resolutions.
Whether a projector is *live* does not — a rig loads switched off, so opening a
patch to look at it never throws windows onto whatever happens to be plugged in.
Press **Open Output** to go live.

---

## Notes for a show

- **Esc** on an output window closes that screen alone, and the rig records it as
  off — the next region nudge will not reopen it.
- **F** or double-click toggles that window's fullscreen; **P** shows its
  performance overlay.
- The editor's render loop is capped to a fixed 60fps while any screen is open,
  so a high-refresh editor display cannot over-drive the shared GPU.
- Closing what is already open is never gated: an entitlement that lapses
  mid-show cannot strand a window on a projector.
- Every screen is a full second render on the same GPU. A rig is limited to eight
  screens, and the shared device is the practical ceiling long before that.

---

## Troubleshooting

**A screen opened as a small window with a title bar.** It had no display left to
take — either every display is already claimed or the machine has only one. Assign
it a display explicitly in the panel.

**A screen shows the whole composition instead of its slice.** The output window
could not create a WebGL2 context, which is what applies the crop. It falls back
to mirroring rather than going black.

**A saved rig points at a display that is not connected.** The assignment is kept
and shown as "not connected". Plug the display back in, or reassign the screen.

---

## See also

- [Projection Mapping](GEOMETRY_MAPPING.md) — corner-pinning onto physical surfaces
- [Dual Screen Setup](dual-screen.md) — the WebSocket streaming path, for remote displays
- [Frame Rate & Display Refresh](frame-rate.md)
