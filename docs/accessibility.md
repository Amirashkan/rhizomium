# Accessibility

Rhizomium can be used without a mouse and with a screen reader. You can enlarge it and raise its
contrast, have it check a patch for flashing before it plays, and preview your work through
different kinds of colour vision.

Every setting below is in **Edit → Accessibility…** (`Ctrl+Shift+,`), which opens Preferences at
its Accessibility section.

---

## Settings

| Setting | What it does | Default |
|---------|--------------|---------|
| **Contrast** | *Standard*, *High* (brighter text, three to four times stronger lines and borders, heavier wires) or *Maximum* (black surfaces, white lines). Applies to the menus, panels and dialogs, and to the node graph itself. | Follows your system: *High* when it asks for more contrast, *Maximum* under Windows' high-contrast themes |
| **Interface size** | 100%–200% for the menus, status bar, dialogs and the contents of panels. The patch canvas has its own zoom: `Ctrl+=` / `Ctrl+-`. | 100% |
| **Focus indicator** | *Bold* draws a thicker, white keyboard-focus ring on every control. | Standard |
| **Interface animation** | *Reduced* turns off the interface's transitions and animations. It doesn't slow the artwork; that's what the motion check below is for. | Follows your system's "reduce motion" |
| **Warn before playing fast motion or flashing** | Holds a patch you open on its first frame until it has been checked (see [Motion and flashing](#motion-and-flashing)). | On if your system asks for reduced motion, otherwise off |
| **Colour vision preview** / **mode** | Filters the preview through a colour-vision profile, either *simulating* it or *correcting* for it (see [Colour vision](#colour-vision)). | Off |
| **Screen reader announcements** | *Normal* announces the result of each action. *Verbose* also announces positions while moving and progress. *Off* announces only what has focus. | Normal |
| **Patch outline order** | How the keyboard and screen readers walk the nodes: *Signal flow* (sources first, output last) or *Canvas position* (left to right). | Signal flow |

**Reset Accessibility Settings** sits at the end of the section. The general **Reset Preferences
to Defaults** leaves these settings alone, so that pressing it by mistake can't remove the
contrast or size someone depends on.

---

## Working without a mouse

### Getting around

| Key | Where it takes you |
|-----|--------------------|
| `Tab` (first press) | **Skip to patch canvas**: jumps past the menu bar to the node graph |
| `F10` | The menu bar. `←` `→` move between menus; `↓`, `Enter` or `Space` opens one; `↑` `↓` walk its items; `→` opens a submenu (`←` closes it); `Esc` closes the menu, and pressing `Esc` again returns you to where you were. |
| `Ctrl+Alt+N` | **View → Focus Patch Canvas**: the node graph, from anywhere |
| `Ctrl+/` | The full keymap, filterable |

Every command in the menus also has its own shortcut. The menus print each one beside its
command.

### The patch canvas

With the patch canvas focused, the keyboard moves through an outline of the patch: one entry per
node, in signal order. Open a node to reach its inputs, outputs and parameters. Wherever the
keyboard is, the matching node is selected, scrolled into view (out from under any floating panel)
and ringed in white on the canvas. A strip along the bottom of the canvas shows the keys that apply
to the current item.

| Key | Action |
|-----|--------|
| `↑` `↓` | Previous / next item (`Ctrl` moves without changing the selection) |
| `→` `←` | Open a node onto its ports and parameters / close it, or step out to the node |
| `Alt+Arrows` | The nearest node in that direction on the canvas |
| `Home` `End` | First / last node |
| `Enter` | On a node: its parameters (the first field gets focus; `Esc` comes back). On a connected port: follow the wire to the other end (on an output that feeds several inputs, `Enter` again visits the next). On a free port: **Connect Pins**. |
| `Space` / `Shift+Space` | Select only this node / add it to or remove it from the selection |
| `C` | Connect. Press `C` on one end (a port, or a node for its first output), move to the other end and press `C` again. On a node, the second `C` uses its first free input. `Esc` cancels. You can use `G` to find the other end; the connection waits for you. |
| `X` | Disconnect the focused port (all wires from an output). `Delete` on a port does the same. |
| `M` | Move the selection: arrows move it by the grid step (`Shift` for five times that), `Enter` drops it, `Esc` puts it back. The whole move is one undo step. |
| `N` | Add a node beside this one. From a port, the new node arrives wired to it. |
| `Delete` | Delete the selection |
| `B` / `S` / `H` | Bypass / cycle preview size / show or hide previews |
| `+` / `-` | Add / remove an input pin (Mix, Switch and other expandable nodes) |
| `F2` | Rename the node |
| `I` / `Shift+I` | Describe the focused item in full / summarise the whole patch |
| `G` | Go to a node by name |
| `Shift+F10` (or the Menu key) | The node's menu, which the arrows walk |
| `Ctrl+A` | Select every node |

Copy, paste, duplicate, undo and the rest of the global shortcuts work as usual while the canvas
has focus.

### Connecting from a list

**Node → Pins → Connect Pins…** (`Ctrl+K`) lists every output and every input, each with a filter
field, and says when the input you picked already has a wire that would be replaced. **Disconnect
Pins…** (`Ctrl+Shift+K`) lists the wires; select one or several and remove them in one undo step.
Both open on the port the keyboard is on.

---

## Screen readers

The patch canvas contains an outline of the graph, an ARIA tree that Chrome's accessibility tree
exposes as:

```
tree "Patch graph"
  treeitem "UV #4, Input node"                       level 1  "No inputs. Feeds Perlin Noise #5."
  treeitem "Perlin Noise #5, Generators node"        level 1  expanded, selected
                                                              "1 input, 1 connected: from UV #4. Feeds Color Mix #8."
    treeitem "Input UV, from UV #4 output uv"                          level 2
    treeitem "Output out (3D vector), feeds Color Mix #8 input Base"   level 2
    treeitem "Parameters, 3"                                           level 2, collapsed
  treeitem "Color Mix #8, Modifiers node"            level 1  "3 inputs, 1 connected: from Perlin Noise #5. Feeds Output #6."
  treeitem "Output #6, Output node"                  level 1  "1 input, 1 connected: from Color Mix #8. Final output."
```

Each node's name gives its title, `#id` and family, and its description summarises its wiring.
Opening a node lists each input with the node feeding it, each output with everything it feeds,
and the parameters with their values. Renamed nodes keep their kind beside the name ("beat gate
(Remap) #12"). With NVDA and JAWS the tree switches to focus mode on its own. With VoiceOver,
interact with the canvas group.

The canvas also tells the browser where the focused node is on screen, so screen magnifiers follow
focus from node to node.

- **Help → Describe Patch…** (`Ctrl+Alt+D`) shows the whole patch as headings and lists for reading
  mode: a summary (what reaches the output, where the signal starts, what is left unconnected),
  then every node in order. **Copy as Text** puts the same structure on the clipboard.
- Results of actions ("Connected Time #7 t to Color Mix #8 input Blend. It replaces the wire
  from…") are spoken through a live region, as set by **Screen reader announcements**.
- Every dialog announces itself, keeps `Tab` inside it, and gives focus back when it closes. On a
  destructive confirmation, focus starts on the safe button.
- Parameter fields are labelled with their parameter's name.

---

## Motion and flashing

With **Warn before playing fast motion or flashing** on, a patch you open is held on its first
frame and checked before it plays. This applies to patches from a file, a backup, a starter or the
AI panel. The check:

1. renders the next two seconds of the shader offscreen at the speed it will play, and measures
   them against the WCAG limit (success criterion 2.3.1): no more than **three flashes, or three
   saturated-red flashes, in any second**, counted over areas large enough to matter, and
2. reads the patch for motion that measurement cannot see, such as fast Wave nodes, per-frame
   random values, expressions running quickly off `time`, fast simulations, audio-reactive
   parameters and video.

If nothing is found, the patch plays. If something is, playback stays paused and a warning says
what was found. You can then **Keep Paused** (the default for `Enter` and `Esc`), **Play at a slower
speed** (picked to bring the fastest flashing under the limit), or **Play Anyway**. A slowed speed
lasts only for that patch.

- **Tools → Check Flashing & Motion…** (`Ctrl+Shift+F`) runs the same check on demand, for example
  before you publish.
- **View → Pause / Play Preview** (`Ctrl+Shift+Space`) stops and starts the preview's clock at any
  time.
- VJ scene changes and coPerformer cues are not interrupted. A dialog in front of a performer
  mid-show would be a hazard of its own, and those scenes were chosen in advance.

The check is a guard, not a certification. It samples two seconds of the shader's own clock, so
audio, video, live input and simulations can still produce flashing it never saw. For broadcast,
use a dedicated photosensitive epilepsy test.

---

## Colour vision

**Colour vision preview** filters the preview window, the node thumbnails and the 3D view (also in
a popped-out preview window) through one of seven profiles: protanopia, deuteranopia and tritanopia
(no red, green or blue cones), their weaker forms (protanomaly, deuteranomaly, tritanomaly), or
achromatopsia (no colour).

- **Simulate** shows the render as a viewer with that kind of colour vision would see it, so you can
  check that a piece still reads.
- **Correct** is for artists with a colour-vision deficiency. It shifts the contrast their eyes miss
  into colours they can see, so colours that collapse into each other separate again.
  Achromatopsia has no correction: there is no colour left to shift into.

The simulation follows Machado, Oliveira & Fernandes (2009), applied in linear RGB. Only your own
view is filtered: exports, published work and output screens always keep their real colours.

---

## Known limits

- **Interface size** enlarges what is laid out by the stylesheet and the contents of panels. The
  frames of floating panels keep the size you gave them, so drag their edges to make room. Long
  menus are zoomed only as far as still fits the window.
- The menu bar keeps its height at every size, so panels placed just below it stay clear of it.
- In a narrow window at a large size, the status bar shortens the cursor position first, then lets
  the frame rate run off its right edge.
