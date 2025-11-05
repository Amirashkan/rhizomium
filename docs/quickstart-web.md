# Quick Start Guide

Get started with Rhizomium in just 5 minutes! This guide will help you create your first visual.

---

## Step 1: Open Rhizomium

Visit **[https://studio.tenderworld.org/](https://studio.tenderworld.org/)** in Chrome or Edge.

You should see the node editor with:
- Dark canvas in the center
- Toolbar at the top
- Right-click menu available

**No installation required** - it runs entirely in your browser!

---

## Step 2: Create Your First Nodes

Let's create a simple animated circle:

### Add a UV Node

1. **Right-click** on the canvas
2. Navigate to **Input → UV**
3. Click to place the node

The UV node provides coordinates for every pixel on the screen.

### Add a Circle Node

1. **Right-click** again
2. Navigate to **Field → Circle**
3. Place it to the right of the UV node

### Connect Them

1. Click and drag from the **UV output** (right side)
2. Connect to the **Circle input** (left side)

You've made your first connection!

---

## Step 3: Add Color

### Add a ColorRamp Node

1. Right-click → **Field → Color Ramp**
2. Place it to the right of Circle
3. Connect **Circle output** to **ColorRamp input**

### Customize the Colors

1. Click on the ColorRamp node
2. Click on the gradient to add color stops
3. Choose your favorite colors!

---

## Step 4: Output Your Visual

### Add an Output Node

1. Right-click → **Output → Output**
2. Place it at the far right
3. Connect **ColorRamp output** to **Output input**

**You should now see your visual in the preview!** 🎉

---

## Step 5: Make It Animate

Let's add some motion:

### Add Time and Math

1. Add a **Time** node (**Input → Time**)
2. Add a **Sine** node (**Math → Sine**)
3. Connect **Time output** to **Sine input**
4. Connect **Sine output** to **Circle's second input** (radius)

Watch your circle pulse with time!

---

## Step 6: Experiment!

Now that you have the basics, try:

### Change Parameters
- Click nodes to adjust their parameters
- Try different values for Circle radius
- Adjust ColorRamp stops

### Try Different Nodes
- Replace Circle with **Noise** or **Voronoi**
- Add **Rotate** or **Scale** transforms
- Use **Math** nodes to combine values

### Add Audio Reactivity
- Add an **Audio** node (**Input → Audio**)
- Click the **Audio Settings** button to enable microphone
- Connect Audio to node parameters
- Play some music! 🎵

---

## Common Controls

- **Add Node**: Right-click → Select category → Choose node
- **Delete Node**: Select node → Press Delete or Backspace
- **Pan Canvas**: Middle-click drag or drag with two fingers
- **Zoom**: Mouse wheel or pinch
- **Save**: Ctrl+S or toolbar Save button
- **Undo**: Ctrl+Z

---

## Next Steps

Ready to learn more?

1. **[Your First Graph](guide.md)** - Detailed step-by-step tutorial
2. **[Interface Overview](interface.md)** - Learn all the features
3. **[Node Reference](node-reference.md)** - Explore 90+ nodes
4. **[Audio Reactivity](audio-web.md)** - Make visuals react to sound

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
