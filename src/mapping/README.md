# Projection Mapping

Corner-pin the rendered output onto the physical surfaces a projector is aimed
at, so a composition lands square on a wall, a column or a set piece instead of
as a rectangle on whatever the projector happens to cover.

Open it from **Tools → Projection Mapping…**

## Features

- **Corner-pin surfaces**: drag the four corners of a quad onto the object's
  edges. The warp is a true perspective transform, so a hard keystone stays
  straight-edged rather than bowing the way a mesh approximation does.
- **Multiple surfaces**: one composition can be split across several objects,
  each showing its own crop, with a draw order you control.
- **Source cropping**: pick which region of the composition each surface shows,
  so one render can feed several physical surfaces without duplicating the graph.
- **Soft edges**: feather a surface's borders to blend overlapping projectors.
- **Alignment grid**: throw a keystoned test grid on the rig to line surfaces up
  before any content is playing.
- **Live output**: edits stream to the second-monitor window as they happen, so a
  corner drag moves on the projector during the drag.
- **Persistent**: surfaces are saved and loaded with your project.

## Components

### homography.js
The projective maths. `solveHomography(src, dst)` finds the unique 3x3 taking one
quad to another from four point correspondences; `invertMat3` and `applyMat3`
support it. Degenerate quads — coincident corners, three points collinear — come
back `null` rather than a matrix that flattens the plane.

### MappingModel.js
The document: an ordered list of surfaces plus every edit the UI performs on
them. Plain data with a change-listener list, no DOM and no GL, so the panel, the
output window and the project file all read the same state through one object.

Coordinates are normalised, never pixels. A surface's `dst` corners are in output
space (0,0 top-left to 1,1 bottom-right of the composition's frame) and its `src`
corners are the region of the composition to sample. A mapping authored against a
720p preview therefore still lands correctly when the project is thrown at 4K. A
`dst` corner may sit outside 0..1 — surfaces routinely need to cover an object
that overshoots the frame — while a `src` corner is clamped into it, since a crop
outside the composition would sample nothing.

Corner order is TL, TR, BR, BL — clockwise from the top-left — everywhere.

### MappingCompositor.js
A WebGL2 pass that draws the frame warped onto each surface. The composition
arrives as an ordinary texture source, so the same code maps a WebGPU render and
a mirrored bitmap without knowing the difference.

Each surface draws its quad as two triangles and the *fragment* shader runs the
inverse homography per pixel — exact, not subdivided. WebGL2 rather than WebGPU
on purpose: this runs alongside a WebGPU renderer that owns its own device and
canvas, and an independent GL context cannot contend with it.

### MappingPanel.js (`src/ui/`)
The editor UI. Its stage is a live warped view of the composition — drawn by the
same compositor the output window uses, so aligning in the panel is aligning on
the projector — with draggable handles over it. The stage shows a little past the
output frame (the dashed rectangle) because corners routinely need to be pulled
beyond it.

## Editing

| Action | Result |
| --- | --- |
| Drag a corner | Pin it |
| Drag inside a surface | Move the whole surface |
| Double-click empty space | Add a surface there |
| `Shift` while dragging | Snap to a 0.05 grid and onto the frame's edges and centre |
| Arrow keys | Nudge (`Shift` coarsens, `Alt` refines) |
| `Tab` | Pick which corner the arrows act on; `Esc` drops the pick |

**Output quad** pins a surface on the projected frame; **Source crop** chooses
what that surface shows. A locked surface ignores drags, so an aligned rig can't
be knocked out of register by a stray click.

## Per-surface flows: the ProjectionMap node

A surface can show the composition, or it can show **its own flow**. Drag a node
out of the graph and drop it on a surface, and that node is wired to the
surface's pin on a `ProjectionMap` node — created on the first drop, so the
gesture never fails for a reason invisible from the panel.

`ProjectionMap` is the mapping *in the graph*: one input pin per surface. That is
what carries a per-surface flow to the projector — the output window re-renders
the editor's broadcast WGSL, so a mapping that lives in the shader arrives there,
and in the floating preview, and in an export, with nothing mapping-shaped having
to cross the wire.

Inputs are sampled as textures, since a surface has to be read at the warped
coordinate its quad implies rather than at the pixel being shaded. A pin fed by
anything that is not already a texture (a Circle, a noise chain) is bridged
through `FragmentTextureRenderer` and published under its own id, the same way a
3D field mapper consumes any graph output — so any subgraph can feed a surface.

The corner geometry reaches the node as **uniform matrices**, not corners.
Inverting a quad is an 8x8 solve, hopeless per fragment, and a baked matrix would
mean recompiling on every mousemove of a drag; the homographies are solved on the
CPU when a corner moves and written straight into the uniform buffer, batched so
one drag is one upload rather than 120.

The node does not replace the panel's own compositor. A surface with no pin
connected falls back to the composition exactly as before, and the panel keeps
warping interactively for editing — except once the node is driving the output,
where the stage presents the render flat, because it already carries the mapping
and warping it again would map a mapping.

## Output

Mapping applies to the second-monitor output window. The editor broadcasts the
model over the shared channel (`SecondMonitorMessage.MAPPING`) on every edit and
again whenever a receiver connects, so a projector window reopened onto the same
rig comes back on its surfaces.

The receiver warps whichever surface just rendered — the native WebGPU path or
the pixel fallback, both work — onto a canvas covering the whole display.
Mapping's 0..1 output space is the render's *letterboxed* rect on that display,
matching the editor's stage exactly; corners pinned outside it land in the
surrounding black.

The VJ master fader moves onto the warp surface while mapping is on, with the
render behind held transparent. CSS opacity does not touch a canvas's pixels, so
the warp still samples the render at full brightness and the fade stays honest.

Without WebGL2, or if the mapping is switched off, the output presents exactly as
it did before — mapping is off by default and adds nothing until switched on.
