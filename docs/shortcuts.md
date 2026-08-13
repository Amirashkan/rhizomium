# Keyboard Shortcuts

Master Rhizomium with these keyboard shortcuts for faster workflow.

---

## Platform Notes

- **Windows/Linux**: Use `Ctrl` key
- **Mac**: Use `Cmd` (⌘) key

When shortcuts list `Ctrl`, Mac users should use `Cmd` instead.

---

## Essential Shortcuts

### Project Management

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+S` | Save Project | Save to browser storage |
| `Ctrl+Shift+S` | Save to Local | Alternative save method |
| `Ctrl+O` | Open File | Open import dialog |
| `Ctrl+N` | New Project | Create new project (prompts to confirm) |
| `Ctrl+L` | Load from Local | Load from browser storage |

### Editing

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Z` | Undo | Undo last action |
| `Ctrl+Y` | Redo | Redo last undone action |
| `Ctrl+Shift+Z` | Redo (Alt) | Alternative redo shortcut |
| `Ctrl+C` | Copy | Copy selected nodes |
| `Ctrl+V` | Paste | Paste copied nodes |
| `Ctrl+D` | Duplicate | Duplicate selected nodes |
| `Delete` | Delete | Delete selected nodes |
| `Backspace` | Delete (Alt) | Alternative delete key |

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

## Tools & Panels

### UI Controls

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+P` | Toggle Preview | Show/hide the floating preview window |
| `Ctrl+Alt+P` | Toggle Profiler | Show/hide the compute profiler overlay (hidden by default; showing it turns on per-frame GPU timing, which costs performance) |
| `Ctrl+Shift+P` | Run Performance Tests | Runs the GPU performance test suite and logs results to the console |
| `Ctrl+Space` | Quick Node Search | Open node search (if available) |
| `Ctrl+B` | Backups | Open backup dialog |
| `Ctrl+V` | VJ Control | Toggle VJ Control panel |
| `Esc` | Close Menu/Panel | Close context menu or parameter panel |
| Double-Click | Edit Parameters | Open parameter panel for node |

### Export & Debug

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+E` | Focus Expression | Focus expression editor (in params) |
| `Ctrl+Shift+E` | Export WGSL | Export shader as WGSL file |
| `Ctrl+L` | Toggle Debug | Toggle debug overlay |

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

### Grid Controls

These live in the menu bar, not on the keyboard:

- **Snap Toggle** - Enable/disable snap-to-grid
- **Grid Size** - Adjust grid spacing (2-512)

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
| `Ctrl+T` | Toggle Timeline | Open/close timeline panel |
| `K` | Add Keyframe | Add keyframe at current time |
| `Space` | Play/Pause | Start/stop timeline playback |
| `←` `→` | Move Playhead | Step timeline left/right |
| `Ctrl+Shift+R` | Reset Timeline | Reset to start |

**When timeline panel is open:**
- **Keyframe Controls** - Use timeline UI
- **Scene Switching** - Use VJ Control panel
- See [Timeline Guide](timeline.md) for details

### Performance Profiler

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+P` | Toggle Profiler | Show/hide performance overlay |
| `Ctrl+Shift+P` | Run Tests | Execute performance tests |
| `Ctrl+Shift+R` | Reset Profiler | Clear profiler statistics |
| `Ctrl+Shift+E` | Toggle Profiling | Enable/disable profiling |

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
| Toggle Preview | `Ctrl+P` |
| Open File | `Ctrl+O` |

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

Currently, keyboard shortcuts are **not customizable** in Rhizomium. They are hard-coded in the application.

If you need different shortcuts, you would need to:
1. Clone the repository
2. Modify `main.js` (setupKeyboardShortcuts function)
3. Run locally

---

## Quick Reference Card

Print or bookmark this page for quick reference!

```
┌─────────────── RHIZOMIUM SHORTCUTS ───────────────┐
│                                                    │
│  ESSENTIAL                                         │
│  Ctrl+S = Save    Ctrl+Z = Undo    Ctrl+C = Copy │
│  Ctrl+O = Open    Ctrl+Y = Redo    Ctrl+V = Paste│
│  Ctrl+D = Duplicate               Delete = Delete │
│                                                    │
│  NAVIGATION                                        │
│  Middle-Drag = Pan       Wheel = Zoom             │
│  F = Frame Selection     Arrows = Move Nodes      │
│                                                    │
│  TOOLS                                             │
│  Ctrl+P = Preview        Ctrl+B = Backups         │
│  Ctrl+V = VJ Control     Esc = Close Menu         │
│  Double-Click = Edit     Right-Click = Add Node   │
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
