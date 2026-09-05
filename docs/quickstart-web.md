# Quick Start Guide

Get started with Rhizomium in just 5 minutes! This guide will help you create your first visual.

---

## Step 1: Open Rhizomium

Visit **[https://studio.tenderworld.org/](https://studio.tenderworld.org/)** in Chrome or Edge.

A welcome dialog greets you on first load:

![The welcome dialog shown on first load](images/welcome-dialog.webp)

Choose **Start New Graph**. (**Open Project File** loads a `.json` you exported
earlier, and **Manage Backups** opens the autosaves the editor keeps as you work.)

You then land in the editor:

![The Rhizomium editor after starting a new graph, with its four main areas numbered](images/editor-overview.annotated.webp)

1. **Menu bar** - File, Edit, View, Node, Tools, Window, Help
2. **Status** - "Idle" or "Shader compiled"
3. **Preview window** - the rendered output, floating over the canvas
4. **Canvas** - the node graph you are building

A new graph is not empty - it starts with **Compute Noise → Gradient → Output**
already wired up, so there is something on screen immediately.

**No installation required** - it runs entirely in your browser!

---

## Step 2: Create Your First Nodes

Let's build a circle from scratch. Start by deleting the three starter nodes
(box-select them with a right-click drag, then press Delete).

### The Add Node menu

**Right-click** anywhere on the canvas. The **Add Node** palette opens with a
search field, the twelve categories down the left, and a few suggested nodes:

![The Add Node palette, with the category rail and the suggested nodes](images/radial-menu.webp)

Click a category to list just the nodes inside it. You do not have to hunt
through them, though - **just start typing** and the search filters every node
by name.

Arrow keys move the selection, **Enter** places the highlighted node at the
cursor, **Tab** cycles the categories, and **Esc** closes the palette.

### Add a UV node

1. **Right-click** on the canvas
2. Type `uv`, or click the **Input** category and pick **UV**
3. Press **Enter** to place it

The UV node provides coordinates for every pixel on the screen.

### Add a Circle node

1. **Right-click** again, to the right of the UV node
2. Type `circle`, or open the **Generators** category
3. Place the **Circle** node

### Connect them

1. Click and drag from the **UV output** (right side)
2. Connect to the **Circle input** (left side)

You've made your first connection!

---

## Step 3: Add Color

### Add a Gradient node

1. Right-click → type `gradient` (it lives under **Generators**)
2. Place it to the right of Circle
3. Connect **Circle output** to the **Gradient** input

### Customize the colors

1. Double-click the Gradient node to open its parameters
2. Adjust the colour stops and the gradient's type and angle
3. Changes apply to the preview as you make them

---

## Step 4: Output Your Visual

### Add an Output node

1. Right-click → type `output` (category **Output**)
2. Place it at the far right
3. Connect **Gradient output** to the **Output** input

**You should now see your visual in the preview!**

---

## Step 5: Make It Animate

The Circle node takes a single input - its **Radius** is a *parameter*, not a
pin, so you animate it with an expression rather than by wiring a node into it.

1. **Double-click** the Circle node to open its parameters
2. Click into the **Radius** field
3. Type `=sin(time) * 0.15 + 0.3`

![The parameter panel for a Circle node, with its parts numbered](images/parameter-panel.annotated.webp)

1. **Panel header** - which node these parameters belong to
2. **Value field** - type a number, or an `=` expression
3. **Evaluated value** - what the expression currently resolves to
4. **Accepted range** for this parameter
5. **Copy reference**, **bind** (MIDI / parameter link), and **keyframe**

The line under the field shows the value the expression currently evaluates to,
and the range the parameter accepts. Watch your circle pulse with time!

Parameters that take expressions can reference `time`, `audioEnvelope`,
`mouse.x` and more - see [Parameter Expressions](parameter-expressions.md).

---

## Step 6: Experiment!

Now that you have the basics, try:

### Change Parameters
- Double-click a node to open its parameters
- Try different values for the Circle's Radius and Softness
- Adjust the Gradient's colour stops

### Try Different Nodes
- Replace Circle with **Perlin Noise** or **Voronoi Noise**
- Add a **Rotate 2D** or **Scale 2D** transform
- Use **Math** nodes to combine values

### Add Audio Reactivity
- Open **Tools → Audio Settings** and enable the microphone
- Type `=audioEnvelope * 0.5` into a parameter field (e.g. the Circle's Radius)
- Play some music!

---

## Common Controls

- **Add Node**: Right-click, then type to search or pick a category
- **Delete Node**: Select node → Press Delete or Backspace
- **Pan Canvas**: Middle-click drag or drag with two fingers
- **Zoom**: Mouse wheel or pinch
- **Save**: Ctrl+S, or **File → Save**
- **Undo**: Ctrl+Z

---

## Next Steps

Ready to learn more?

1. **[Your First Graph](guide.md)** - Detailed step-by-step tutorial
2. **[Interface Overview](interface.md)** - Learn all the features
3. **[Node Reference](node-reference.md)** - Explore all 133 nodes
4. **[Parameter Expressions](parameter-expressions.md)** - Animate with math formulas
5. **[Compute Nodes](compute-nodes.md)** - GPU-accelerated effects
6. **[Audio Reactivity](audio-web.md)** - Make visuals react to sound
7. **[MIDI Controllers](midi.md)** - Control with hardware
8. **[Timeline Animation](timeline.md)** - Create keyframe animations

---

## Need Help?

- **Black preview?** Make sure you have an Output node connected
- **Can't add nodes?** Try right-clicking on an empty area
- **Browser not supported?** Use Chrome 113+ or Edge 113+
- **More questions?** Check the **[FAQ](faq-web.md)**

---

**Tip**: Save your work frequently with Ctrl+S!

---

_Happy creating! Share your visuals with the world._
