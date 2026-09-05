# Keyboard Shortcuts

Every command in the menu bar has a key, and the menu prints it next to the
command — you never have to come here to find one. **Help → Shortcuts / Keymap**
(`Ctrl+/`) shows this same table inside the app, with a filter box.

---

## Platform Notes

- **Windows/Linux**: Use `Ctrl` key
- **Mac**: Use `Cmd` (⌘) key

When shortcuts list `Ctrl`, Mac users should use `Cmd` instead. Where a
shortcut adds `Alt`, that is `Option` (⌥) on a Mac.

Shortcuts pause while you are typing in a text field, and while a modal dialog
is open.

---

## File

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+N` | New Project | Starts a fresh graph (asks first) |
| `Ctrl+O` | Open Project… | Open a `.rz` / `.json` patch |
| `Ctrl+S` | Save | Write back to the bound file |
| `Ctrl+Shift+S` | Save As… | Pick a new name / location |
| `Ctrl+Shift+O` | File Manager | Browse saved projects |
| `Ctrl+Shift+X` | Export | Open the export window |
| `Ctrl+Shift+U` | Publish Image… | Share the render to the TenderWorld gallery |
| `Ctrl+Alt+U` | Publish Animation… | Share an animation to the gallery |
| `Ctrl+B` | Backups | Open the backup dialog |
| `Ctrl+Alt+Q` | Exit | |
| `Ctrl+Shift+L` | Load from browser storage | Restores this browser's autosave |

## Edit

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Z` | Undo | Undo last action |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo | Redo last undone action |
| `Ctrl+X` | Cut | Cut selected nodes |
| `Ctrl+C` | Copy | Copy selected nodes (preserves connections) |
| `Ctrl+V` | Paste | Paste copied nodes |
| `Delete` / `Backspace` | Delete | Delete selected nodes |
| `Ctrl+Shift+R` | Rebuild Shader | Recompile from the current graph |
| `Ctrl+,` | Preferences… | |
| `Ctrl+E` | Edit expression | Focus the expression field of the open parameter |
| `F2` | Rename node | With exactly one node selected |

## View

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+1` | Toggle ParamPanel | |
| `Ctrl+2` / `Ctrl+P` | Toggle Preview Panel | The floating preview window |
| `Ctrl+3` | Toggle 3D Viewport | |
| `Ctrl+Shift+P` | Preview / Export Settings | Render resolution and format |
| `Ctrl+=` | Zoom In | `Ctrl++` works too |
| `Ctrl+-` | Zoom Out | |
| `Ctrl+0` | Reset Zoom | Back to 100%, centred |
| `Ctrl+Shift+G` | Show Grid | |
| `Ctrl+G` | Snap to Grid | |
| `` Ctrl+` `` | Console | The generated WGSL panel |
| `Ctrl+Alt+T` | Timeline | |
| `Ctrl+Shift+V` | VJ Control | |
| `Ctrl+Alt+P` | Compute Profiler | Per-frame GPU timing; costs performance while open |
| `Ctrl+Shift+2` | Open / Close Output | Turns on every screen in the rig. Desktop / Vite build only |
| `Ctrl+Shift+3` | Output Screens… | Lay the patch out across several displays. Desktop / Vite build only |

## Node

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Space` | Create Node… | Search palette at the centre of the canvas |
| `Tab` | Create Node… (on a wire) | While dragging a wire, drops the new node onto it |
| `Delete` | Delete Node | |
| `Ctrl+D` | Duplicate Node | |
| `Ctrl+K` | Connect Pins | |
| `Ctrl+Shift+K` | Disconnect Pins | |
| `Ctrl+I` | Node Settings / Params… | |

## Tools

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Shift+A` | AI Assistant… | |
| `Ctrl+Alt+S` | Script Editor / Python Console | |
| `Ctrl+Alt+C` | Shader Compiler | |
| `Ctrl+Alt+G` | GLSL Utilities | GLSL → WGSL conversion, snippets, node-body reference |
| `Ctrl+Shift+M` | Projection Mapping… | |
| `Ctrl+Alt+A` | Audio Settings | |
| `Ctrl+Alt+M` | MIDI Settings | |
| `Ctrl+Alt+O` | OSC Receiver | |

## Window

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Alt+1` | Layout: Default | The preview over the graph |
| `Ctrl+Alt+2` | Layout: Custom | The arrangement you saved |
| `Ctrl+Alt+3` | Layout: Minimal | Nothing but the node graph |
| `Ctrl+Alt+4` | Save Current as Custom | Writes the Custom layout from the panels open right now |
| `Ctrl+Alt+F` | Floating Windows | Hides every panel, and puts the same ones back |
| `Ctrl+Alt+0` | Reset Layout | Default arrangement, default positions and sizes |

## Help

| Shortcut | Action | Description |
|----------|--------|-------------|
| `F1` | Documentation | Opens this site |
| `Ctrl+/` | Shortcuts / Keymap | The in-app keymap (`?` works too) |
| `Ctrl+Alt+W` | Welcome | |
| `Ctrl+Alt+I` | About | |

## Canvas

| Shortcut | Action | Description |
|----------|--------|-------------|
| `F` | Frame Selection | Fits the selection — or the whole graph — to the view |
| `H` | Show / hide previews | Toggles the thumbnails of every selected node |
| `Esc` | Close menu / panel | Also cancels a wire drag |

### Selection

| Shortcut | Action | Description |
|----------|--------|-------------|
| Click | Select Node | Select single node |
| `Shift+Click` | Add to Selection | Add node to current selection |
| Right-Drag | Box Select | Drag to select multiple nodes |
| Click Canvas | Deselect All | Clear selection |
| `Ctrl+A` | Select All | Select all nodes (if implemented) |

---

## Navigation

### Canvas Movement

| Shortcut | Action | Description |
|----------|--------|-------------|
| Middle-Drag | Pan Canvas | Move around the canvas |
| Right-Drag | Pan (Alt) | Alternative pan method |
| Mouse Wheel | Zoom In/Out | Zoom centered on cursor |
| `Ctrl+Drag` | Zoom Drag | Drag up/down to zoom |
| `F` | Frame Selection | Center view on selected nodes |
| `F` (no selection) | Frame All | Center view on all nodes |

### Node Movement

| Shortcut | Action | Description |
|----------|--------|-------------|
| Click-Drag | Move Node | Drag selected nodes |
| `←` | Move Left | Move selected nodes left by 1px |
| `→` | Move Right | Move selected nodes right by 1px |
| `↑` | Move Up | Move selected nodes up by 1px |
| `↓` | Move Down | Move selected nodes down by 1px |
| `Shift+←` | Move Left (Fast) | Move left by 10px |
| `Shift+→` | Move Right (Fast) | Move right by 10px |
| `Shift+↑` | Move Up (Fast) | Move up by 10px |
| `Shift+↓` | Move Down (Fast) | Move down by 10px |

**Note:** When snap-to-grid is enabled, arrow keys move by grid size instead.

---

## WGSL Console

The generated-shader panel (`` Ctrl+` ``) has its own commands, live while it is
open:

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Shift+E` | Export WGSL | Save the generated shader to a file |
| `Ctrl+Alt+E` | Select All Code | |
| `Ctrl+Alt+Y` | Copy Code | |

### Other

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Shift+C` | Compute shader test | Developer toggle |
| Double-Click | Edit Parameters | Open the parameter panel for a node |

---

## Context Menu

### Opening Menus

| Action | Method | Description |
|--------|--------|-------------|
| Add Node | Right-Click Canvas | Open radial node menu |
| Node Actions | Right-Click Node | Open node context menu |
| Close Menu | `Esc` or Click Away | Hide open menu |

### Node Menu Navigation

- **Move mouse** to highlight categories
- **Click** to select node type
- **Esc** to cancel

---

## Node Operations

### Creating Connections

| Action | Method |
|--------|--------|
| Start Wire | Click-Drag from Output Pin (right side) |
| Complete Connection | Release on Input Pin (left side) |
| Cancel Wire | Press `Esc` or click canvas |

### Removing Connections

| Action | Method |
|--------|--------|
| Remove Input | Click Input Pin (left side) |
| Delete Wire | Select wire + Press `Delete` |

### Node Preview Controls

| Action | Shortcut |
|--------|----------|
| Toggle Node Preview | Click eye button on node |
| Cycle Preview Size | Click size button (S/M/L) |
| Hide Visual Info | Click X button on node |

---

## Grid & Snapping

Under **View → Grid**:

- **Show Grid** (`Ctrl+Shift+G`) - Draw the grid behind the graph
- **Snap to Grid** (`Ctrl+G`) - Enable/disable snap-to-grid
- **Grid Size** - Adjust grid spacing (2-512); menu only

When snap is enabled, arrow key movement uses grid size.

---

## Audio Shortcuts

**Audio:**
- Open **Tools → Audio Settings**
- No dedicated keyboard shortcuts
- See [Audio Reactivity Guide](audio-web.md)

**MIDI:**
- **Tools → MIDI Settings**
- **MIDI Learn** - Click parameter + Learn button, then move controller
- See [MIDI Controller Guide](midi.md) for setup

---

## Advanced Shortcuts

### Expression Editor

When parameter panel is open:

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+E` | Focus Expression | Jump to expression input |
| `=` Button | Toggle Expression | Switch to expression mode |
| `Enter` | Apply Expression | Confirm expression |
| `Esc` | Cancel Edit | Close parameter panel |

### Timeline & Animation

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Alt+T` | Toggle Timeline | Open/close timeline panel |
| `K` | Add Keyframe | Add keyframe at current time |
| `Space` | Play/Pause | Start/stop timeline playback |
| `←` `→` | Move Playhead | Step timeline left/right |

**When timeline panel is open:**
- **Keyframe Controls** - Use timeline UI
- **Scene Switching** - Use VJ Control panel
- See [Timeline Guide](timeline.md) for details

### Performance Profiler

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Alt+P` | Toggle Profiler | Show/hide performance overlay (also View ▸ Compute Profiler) |
| `Ctrl+Alt+Shift+P` | Run Tests | Execute performance tests |
| `Ctrl+Alt+Shift+R` | Reset Profiler | Clear profiler statistics |
| `Ctrl+Alt+Shift+E` | Toggle Profiling | Enable/disable profiling |

The three developer keys carry `Alt` so they stay clear of the editor's own
`Ctrl+Shift+P` / `R` / `E`.

**In profiler overlay:**
- **+** - Expand to show detailed breakdown
- **−** - Collapse to compact view
- **×** - Close overlay

See [Performance Profiler Guide](profiler.md) for details.

---

## Pro Tips

### Workflow Acceleration

1. **Learn Copy/Paste/Duplicate**
   - Copy (`Ctrl+C`) preserves connections
   - Duplicate (`Ctrl+D`) is faster for quick copies
   - Paste (`Ctrl+V`) creates new instances

2. **Use Arrow Keys for Precision**
   - Fine-tune node positions without mouse
   - Hold Shift for larger movements
   - Enable snap for grid-aligned layouts

3. **Master Undo/Redo**
   - Undo works for: node creation, deletion, movement, connections, parameter changes
   - Redo restores exactly what was undone
   - Undo history survives most operations

4. **Frame Selection Frequently**
   - Press `F` to instantly center on your work
   - Great after paste operations
   - Useful when zoomed in too far

### Efficiency Tricks

1. **Quick Save Habit**
   - Press `Ctrl+S` every few minutes
   - Autosave may not catch everything
   - Browser crashes lose unsaved work

2. **Zoom to Cursor**
   - Mouse wheel zooms where cursor is
   - Position cursor before zooming
   - Saves time panning afterwards

3. **Box Select Groups**
   - Right-click drag is faster than Shift+clicking
   - Select entire sections at once
   - Move related nodes together

4. **Double-Click for Parameters**
   - Faster than menus
   - Opens exactly what you need
   - Close with `Esc` or click away

---

## Shortcut Summary Tables

### Most Used Shortcuts

| Action | Shortcut |
|--------|----------|
| Save | `Ctrl+S` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y` |
| Copy | `Ctrl+C` |
| Paste | `Ctrl+V` |
| Duplicate | `Ctrl+D` |
| Delete | `Delete` |
| Frame Selection | `F` |
| Toggle Preview Panel | `Ctrl+2` |
| Open File | `Ctrl+O` |
| Keymap | `Ctrl+/` |

### Canvas Navigation

| Action | Method |
|--------|--------|
| Pan | Middle-Drag or Right-Drag |
| Zoom | Mouse Wheel |
| Frame | `F` key |
| Move Nodes | Arrow Keys |

### Node Operations

| Action | Method |
|--------|--------|
| Add Node | Right-Click Canvas |
| Delete Node | `Delete` or `Backspace` |
| Edit Node | Double-Click |
| Connect Nodes | Drag Output → Input |
| Disconnect | Click Input Pin |

---

## Troubleshooting Shortcuts

### Shortcuts Not Working?

**Check if you're in an input field:**
- Shortcuts are disabled when typing
- Click canvas or press `Esc` to exit input
- Then try shortcut again

**Browser may intercept shortcuts:**
- `Ctrl+N` - Browser new window (use with caution)
- `Ctrl+W` - Browser close tab (not used by Rhizomium)
- `Ctrl+T` - Browser new tab (not used by Rhizomium)

**Mac Command Key:**
- Make sure you're using `Cmd` not `Ctrl`
- Some shortcuts work differently on Mac
- `Cmd+Q` still quits browser

### Undo/Redo Not Working?

- Make sure UndoManager is initialized
- Check browser console for errors
- Some operations may not be undoable yet
- Refresh page if undo system is stuck

### Arrow Keys Not Moving Nodes?

- Must have nodes selected first
- Click canvas if nothing happens
- Make sure parameter panel is closed
- Arrow keys only work when body has focus

---

## Customizing Shortcuts

Shortcuts are **not customizable** from the UI yet — the keymap ships with the
application.

All of it lives in one file, `src/ui/shortcuts.js`. That table is what prints
the hints in the menus, what fires the commands, and what the Help → Shortcuts
dialog shows, so changing a key there changes all three at once:

1. Clone the repository
2. Edit the entry's `keys` in `src/ui/shortcuts.js`
3. Run locally (`npm run dev`)

---

## Quick Reference Card

Print or bookmark this page for quick reference!

```
┌─────────────── RHIZOMIUM SHORTCUTS ───────────────┐
│                                                    │
│  ESSENTIAL                                         │
│  Ctrl+S = Save      Ctrl+Z = Undo   Ctrl+C = Copy │
│  Ctrl+O = Open      Ctrl+Y = Redo   Ctrl+V = Paste│
│  Ctrl+D = Duplicate                Delete = Delete│
│                                                    │
│  NAVIGATION                                        │
│  Middle-Drag = Pan        Wheel = Zoom            │
│  F = Frame Selection      Arrows = Move Nodes     │
│  Ctrl+0 = Reset Zoom      Ctrl+G = Snap to Grid   │
│                                                    │
│  PANELS                                            │
│  Ctrl+1 = Params    Ctrl+2 = Preview   Ctrl+3 = 3D│
│  Ctrl+` = Console   Ctrl+Alt+T = Timeline         │
│                                                    │
│  TOOLS                                             │
│  Ctrl+Space = Add Node    Ctrl+B = Backups        │
│  Ctrl+Shift+V = VJ        Esc = Close Menu        │
│  Ctrl+/ = Full Keymap     Right-Click = Add Node  │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## Next Steps

- **[Interface Overview](interface.md)** - Learn the UI
- **[Quick Start Guide](quickstart-web.md)** - Build your first graph
- **[Performance Tips](performance.md)** - Optimize your workflow
- **[FAQ](faq-web.md)** - Common questions

---

_Speed up your creative process with keyboard shortcuts!_
