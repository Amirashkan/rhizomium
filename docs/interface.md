# Interface Overview

Get familiar with the Rhizomium interface and learn how to navigate the editor efficiently.

---

## Main Interface Elements

When you open Rhizomium, you'll see four main areas:

### 1. Canvas (Center)

The large dark area where you build your node graphs.

- **Background grid** helps align nodes
- **Zoom in/out** with mouse wheel
- **Pan** by middle-clicking and dragging
- **Select nodes** by clicking them
- **Box select** by right-click dragging

### 2. Toolbar (Top)

The horizontal menu bar with buttons and controls:

**Core Actions:**
- **Toggle Preview** - Show/hide the preview window
- **Dock Preview** - Snap preview to canvas or float it
- **Lock Preview** - Prevent preview from moving
- **Fullscreen** - Expand preview to full screen

**Grid & Snapping:**
- **Snap Toggle** - Enable grid snapping
- **Grid Size** - Adjust snap grid spacing (default: 20)

**History:**
- **Undo** - Revert last action (Ctrl+Z)
- **Redo** - Redo undone action (Ctrl+Y)

**Project Management:**
- **Save Project** - Save to browser storage
- **Load Project** - Load saved projects
- **Backups** - View autosave backups
- **Export JSON** - Download project file
- **Import** - Load project from file

**Tools:**
- **Rebuild** - Recompile shader
- **Console** - View generated WGSL code
- **Audio Settings** - Configure audio reactivity
- **MIDI Settings** - Connect and map MIDI controllers
- **Timeline** - Open keyframe timeline (Ctrl+T)
- **Profiler** - Performance monitoring overlay (Ctrl+P)
- **VJ Control** - Scene management panel
- **Open External Viewer** - Launch fullscreen window (local only)

**Display Settings:**
- **Resolution** - Set preview resolution (960x540 to 4K)
- **Display** - Choose monitor for external viewer

### 3. Preview Window

Shows your visual output in real-time:

- **Floating or docked** - Choose your layout
- **Resizable** - Drag corners to resize
- **Drag to move** - Click and drag to reposition
- **Control buttons** in top-right:
  - Close button
  - Fullscreen button
  - Lock button

### 4. Right-Click Menu

Context-sensitive menu that appears when you right-click:

**On Canvas:**
- Radial node menu organized by category
- **Input** - Constants, UV, Time, Mouse, Audio
- **Output** - Final output node
- **Field** - Patterns, shapes, noise
- **Math** - Arithmetic, trigonometry
- **Utility** - Color, data manipulation
- **Blend** - SDF operations
- **Transform** - UV effects, distortion

**On Node:**
- Delete node
- Duplicate node
- Edit parameters
- Show/hide preview

---

## Canvas Controls

### Navigation

**Panning:**
- Middle-click + drag
- Two-finger drag (trackpad)
- Right-click + drag (when not over nodes)

**Zooming:**
- Mouse wheel up/down
- Pinch gesture (trackpad)
- Ctrl + drag up/down
- Zoom centers on cursor position

**Framing:**
- Press **F** to frame selected nodes
- Press **F** with nothing selected to frame all nodes

### Selection

**Single Selection:**
- Click a node to select it
- Selected nodes have a highlight border
- Click canvas to deselect

**Multiple Selection:**
- Hold Shift + click to add to selection
- Right-click + drag for box selection
- Box select captures all nodes in rectangle

**Moving Nodes:**
- Click and drag selected nodes
- Arrow keys nudge by 1 pixel
- Shift + Arrow keys nudge by 10 pixels
- With snap enabled, uses grid size

---

## Node Anatomy

Each node has several parts:

### Header
- **Title** - Node type name
- **Color bar** - Category color coding:
  - Green (emerald): Input nodes
  - Amber: Math nodes
  - Cyan: Utility nodes
  - Red: Output node
  - Gray: other categories

### Body
- **Input pins** (left side) - Receive data
- **Output pins** (right side) - Send data
- **Parameters** below inputs
- **Preview thumbnail** (when enabled)

### Controls (Top-right of node)
- **X button** - Hide visual info
- **Eye button** - Toggle preview thumbnail
- **Size button** - Cycle preview size (S/M/L)

### Connection Points
- **Output pins** - Small circles on right side
- **Input pins** - Small squares on left side
- **Hover** to see pin names and types
- **Color coding** indicates data type:
  - White: Float (single number)
  - Yellow: Vec2 (2D vector)
  - Green: Vec3 (3D vector/color)
  - Red: Vec4 (4D vector/RGBA)

---

## Working with Nodes

### Adding Nodes

1. Right-click on canvas
2. Navigate category menu
3. Click node name
4. Node appears at cursor position

**Tip:** Use Ctrl+Space for quick search (if available)

### Connecting Nodes

1. Click and drag from an **output pin** (right side)
2. Drag wire to an **input pin** (left side)
3. Release to create connection
4. Wire color matches data type

**Valid Connections:**
- Output → Input only (left to right)
- One output can connect to many inputs
- One input can only have one connection
- Type mismatches auto-convert when possible

### Disconnecting Nodes

**Method 1:** Click an input pin to remove its connection

**Method 2:** Select connection wire and press Delete

**Method 3:** Drag a new connection to replace old one

### Editing Parameters

**Double-click** a node to open the parameter panel:

- Adjust values with sliders or inputs
- Color pickers for color parameters
- Dropdowns for options
- File pickers for textures
- **Expression mode** (=) for math formulas

**Click outside** the panel to close it

### Deleting Nodes

- Select node(s) and press **Delete** or **Backspace**
- Or right-click node and choose "Delete"
- Connections are removed automatically

---

## Parameter Panel

Opens when you double-click a node:

### Panel Layout
- **Header** - Node name and close button
- **Parameters** - Organized by type
- **Real-time updates** - Changes apply immediately

### Parameter Types

**Numeric:**
- Sliders with text input
- Click number to type directly
- Arrow keys to adjust

**Color:**
- Color picker interface
- RGB/HSV values
- Hex input
- Swatch preview

**Boolean:**
- Checkbox toggle
- On/Off states

**Dropdown:**
- Click to show options
- Select from list

**File:**
- Browse button
- Drag-and-drop support (textures)

**Expression (=):**
- Click **=** button to enable
- Write math formulas
- Reference `time`, `audioEnvelope`, `mouse.x`, etc.
- Real-time evaluation
- See [Parameter Expressions Guide](parameter-expressions.md) for details

---

## Preview Window

### Window Modes

**Floating Mode:**
- Drag to reposition
- Resize by corners
- Can move off-canvas

**Docked Mode:**
- Snaps to canvas edge
- Resizes with browser
- Stays in bounds

**Locked Mode:**
- Prevents accidental moves
- Unlock to reposition

**Fullscreen Mode:**
- Fills entire screen
- Press Esc to exit
- Hides UI elements

### Node Previews

Individual nodes can show preview thumbnails:

**Per-Node Toggle:**
- Click the eye button on a node to show or hide its thumbnail
- The eye icon reflects the node's current state (open = visible, closed = hidden)
- The on/off state is saved with your graph

**Defaults:**
- Visual nodes (patterns, colors, textures, compute nodes) show a thumbnail by default
- Numeric/scalar nodes (Math, constants, Time, etc.) hide their thumbnail by default — it would only be a flat swatch. Their output value still shows next to the output pin, and the first click on the eye button turns the thumbnail on

**Preview Sizes:**
- **S** (Small) - 32x32 pixels
- **M** (Medium) - 64x64 pixels
- **L** (Large) - 128x128 pixels

**Performance:**
- Small previews = better performance
- Disable previews for complex graphs
- Only visible nodes compute previews

---

## Console Window

View and export generated WGSL shader code:

**Open:** Click "Console" button in toolbar

**Features:**
- **Select All** - Highlight all code
- **Copy** - Copy to clipboard
- **Export WGSL** - Save as .wgsl file
- **Close** - Hide console

**Use Cases:**
- Debug shader compilation
- Learn WGSL from your graphs
- Share shader code
- Use in external projects

---

## Audio Settings Panel

Configure audio reactivity:

**Open:** Click "Audio Settings" button

**Controls:**
- **Enable/Disable** - Toggle audio input
- **Input Source** - Choose microphone
- **Gain** - Amplify audio signal (0.5-5.0)
- **Smoothing** - Response speed (0.1-0.9)
- **Frequency Ranges** - Customize bass/mid/high bands

**Visual Feedback:**
- Real-time frequency bars
- Bass, mid, high indicators
- Level meters

See [Audio Reactivity Guide](audio-web.md) for details.

---

## MIDI Settings Panel

Control parameters with MIDI controllers:

**Open:** Click "MIDI Settings" button in toolbar

**Features:**
- **Device Detection** - Automatically lists connected MIDI controllers
- **MIDI Learn** - Easy parameter mapping
- **Binding Management** - View and edit MIDI mappings
- **Activity Monitor** - Real-time MIDI input display

**Quick Setup:**
1. Connect MIDI controller via USB
2. Click "Enable MIDI" and grant permission
3. Click parameter field → Click "MIDI Learn"
4. Move controller knob/slider
5. Parameter is now mapped!

See [MIDI Controller Integration Guide](midi.md) for complete instructions.

---

## Timeline Panel

Create keyframe animations:

**Open:** Click "Timeline" button or press **Ctrl+T**

**Features:**
- **Keyframe Editor** - Add, edit, delete keyframes
- **Playback Controls** - Play, pause, scrub timeline
- **Interpolation** - Linear, ease, bezier curves
- **Multiple Tracks** - Animate multiple parameters
- **Loop Support** - Seamless looping animations

**Quick Start:**
1. Enable Timeline toggle
2. Set playhead to start time
3. Adjust parameter value
4. Click "Add Keyframe" (or press K)
5. Move playhead, adjust value, add another keyframe
6. Click Play to see animation!

See [Timeline & Keyframes Guide](timeline.md) for detailed instructions.

---

## Performance Profiler

Monitor real-time performance:

**Open:** Press **Ctrl+P** or click Profiler button

**Displays:**
- **FPS** - Frames per second (target: 60)
- **Frame Time** - Milliseconds per frame
- **Compute Time** - GPU compute shader timing
- **Dispatch Breakdown** - Per-node performance

**Color Coding:**
- Green (≥60 FPS) - Excellent
- Yellow (30-59 FPS) - Acceptable
- Red (<30 FPS) - Poor

**Controls:**
- **+** - Expand to see detailed breakdown
- **−** - Collapse to compact view
- **×** - Close overlay
- **Ctrl+Shift+R** - Reset statistics

See [Performance Profiler Guide](profiler.md) for detailed information.

---

## Status Bar

Bottom-right corner shows current status:

- **Idle** - Ready for input
- **Compiling...** - Building shader
- **Saved** - Project saved successfully
- **Error** - Shader compilation failed
- **Loading...** - Loading project

Status updates automatically as you work.

---

## Tips for Efficient Workflow

### Organization

1. **Use grid snap** - Keep nodes aligned
2. **Group related nodes** - Organize by function
3. **Leave space** - Don't overcrowd canvas
4. **Color categories** - Learn category colors

### Navigation

1. **Learn shortcuts** - See [Keyboard Shortcuts](shortcuts.md)
2. **Use zoom effectively** - Zoom out to see big picture
3. **Frame selection** - Press F to focus
4. **Pan frequently** - Keep relevant nodes visible

### Performance

1. **Disable unused previews** - Saves GPU resources
2. **Lower preview resolution** - For complex graphs
3. **Toggle main preview** - When not needed
4. **Close console** - When not debugging

### Productivity

1. **Duplicate nodes** - Ctrl+D for quick copies
2. **Multi-select** - Shift+click or box select
3. **Arrow key nudging** - Fine-tune positions
4. **Save frequently** - Ctrl+S every few minutes

---

## Customization

### Grid Settings

Adjust snap grid to your preference:
- Small grids (10-15) - Precise placement
- Medium grids (20-30) - Balanced
- Large grids (40-60) - Coarse alignment

### Preview Position

Position preview where it works for you:
- **Right side** - Traditional layout
- **Left side** - Extra canvas space
- **Bottom** - Wide preview
- **Floating** - Separate window

### Resolution

Choose resolution based on your needs:
- **960x540** - Low-end GPUs, best performance
- **1280x720** - Balanced quality/performance
- **1920x1080** - Standard HD, recommended
- **2560x1440** - High quality
- **3840x2160** - 4K, powerful GPUs only

---

## Common Questions

### Canvas is zoomed too far in/out?

Use mouse wheel to zoom, or press F to frame all nodes.

### Can't see preview?

Click "Toggle Preview" button, or press Ctrl+P.

### Nodes won't connect?

Check that you're dragging from output (right) to input (left). Some types can't connect.

### Preview shows black screen?

Make sure you have an **Output** node connected to your graph.

### Parameter panel won't open?

Double-click the node. Make sure you're clicking the node body, not a pin.

---

## Next Steps

- **[Keyboard Shortcuts](shortcuts.md)** - Learn all shortcuts
- **[Parameter Expressions](parameter-expressions.md)** - Animate with math
- **[MIDI Controllers](midi.md)** - Hardware control setup
- **[Timeline Animation](timeline.md)** - Keyframe system
- **[Performance Tips](performance.md)** - Optimize your graphs
- **[Performance Profiler](profiler.md)** - Monitor performance
- **[Node Reference](node-reference.md)** - Explore all nodes
- **[Compute Nodes](compute-nodes.md)** - GPU-accelerated effects
- **[Quick Start Guide](quickstart-web.md)** - Build your first graph

---

_Master the interface, unlock your creativity!_
