# Your First Graph

This guide will walk you through creating your first visual composition in Rhizomium. You'll learn the basics of the node editor and create a simple animated pattern.

---

## 🎯 What You'll Build

By the end of this guide, you'll have created a colorful, animated circular pattern that reacts to time. This will teach you:

- How to add nodes to the canvas
- How to connect nodes together
- How to use parameters to control your visual
- How to see your result in real-time

---

## 📋 Prerequisites

Before you start, make sure you have:

1. ✅ Rhizomium running locally or accessed via the web
2. ✅ A browser with WebGPU support (Chrome 113+ or Edge 113+)
3. ✅ The node editor open (usually at `/studio` or `/editor`)

If you haven't set up Rhizomium yet, check out the [Quick Start guide](quickstart.md).

---

## 🧩 Understanding the Node Editor

When you open the editor, you'll see:

- **Canvas** - The main area where you place and connect nodes
- **Node Palette** - Browse and add nodes (usually on the left or via right-click)
- **Properties Panel** - Adjust parameters for selected nodes
- **Preview Window** - See your visual output in real-time
- **Toolbar** - Save, load, and control your project

### Basic Controls

- **Add Node**: Right-click on canvas → Select node type
- **Connect Nodes**: Drag from output pin to input pin
- **Move Nodes**: Click and drag node header
- **Delete Node**: Select node → Press Delete or Backspace
- **Pan Canvas**: Middle-click and drag, or scroll to pan
- **Zoom**: Mouse wheel or pinch gesture

---

## 🎨 Step-by-Step Tutorial

### Step 1: Create UV Coordinates

Every visual starts with UV coordinates - these tell the shader where each pixel is located.

1. Right-click on the canvas
2. Navigate to **Input** → **UV**
3. Click to place the UV node

The UV node outputs normalized coordinates (0-1) for each pixel on the screen.

### Step 2: Add a Circle Field

Now let's create a circular distance field.

1. Right-click on the canvas
2. Navigate to **Generators** → **Circle**
3. Place it near your UV node

The Circle node calculates the distance from the center, creating a radial pattern.

### Step 3: Connect UV to Circle

1. Click and drag from the **UV output** (right side of UV node)
2. Connect to the **Circle input** (left side of Circle node)
3. A line will appear showing the connection

### Step 4: Add Animation with Time

Let's make it animate!

1. Add a **Time** node: **Input** → **Time**
2. Add a **Multiply** node: **Math** → **Multiply**
3. Connect **Time** output to **Multiply** input 1
4. Set the second input of Multiply to **0.5** (this controls animation speed)

### Step 5: Modulate the Circle

Now we'll use the time to animate the circle's radius.

1. Add a **Sin** node: **Math** → **Sin**
2. Connect **Multiply** output to **Sin** input
3. Add an **Add** node: **Math** → **Add**
4. Connect **Circle** output to **Add** input 1
5. Connect **Sin** output to **Add** input 2

This creates a pulsing effect!

### Step 6: Add Color

Time to add some color to our visual.

1. Add a **Color Ramp** node: **Generators** → **Color Ramp**
2. Connect the **Add** output to **ColorRamp** input
3. Click on the ColorRamp node to open its parameters
4. Add color stops by clicking the gradient:
   - Position 0.0: Choose a dark color (e.g., deep purple)
   - Position 0.5: Choose a bright color (e.g., cyan)
   - Position 1.0: Choose another color (e.g., pink)

### Step 7: Output Your Visual

Finally, send your colored pattern to the screen.

1. Add an **Output** node: **Output** → **Output**
2. Connect **ColorRamp** output to **Output** input
3. The preview window should now show your animated, colored pattern!

---

## 🎨 Experiment and Explore

Now that you have a basic graph, try experimenting:

- **Change colors** - Modify the ColorRamp stops
- **Adjust speed** - Change the Multiply value (step 4)
- **Add complexity** - Try different Generator nodes (Voronoi, Noise, etc.)
- **Layer patterns** - Use Blend nodes to combine multiple patterns
- **Add more animation** - Connect Time to other parameters

### Suggested Experiments

#### Experiment 1: Add Rotation

1. Add a **Rotate 2D** node (**Transform** → **Rotate 2D**) between UV and Circle
2. Connect Time to the angle parameter
3. Watch your pattern spin!

#### Experiment 2: Multiple Circles

1. Duplicate your Circle (Ctrl+D or Cmd+D)
2. Change its parameters (scale, position)
3. Use a **Blend** node to combine them
4. Try different blend modes (Union, Intersect, Subtract)

#### Experiment 3: Audio Reactivity

1. Enable audio input in the **Audio Settings** panel
2. Type an expression like `=audioEnvelope * 0.5` into a parameter field (e.g. the Circle's Radius)
3. Play some music and watch your visual dance!

See [Audio Reactivity](audio-web.md) for details.

---

## 💡 Understanding Data Flow

In Rhizomium, data flows from **left to right**:

```
Input Nodes → Processing Nodes → Output Node
(UV, Time)   (Fields, Math, Color)   (Display)
```

### Data Types

Nodes work with different data types:

- **Float** - Single number (e.g., 0.5, 2.0)
- **Vec2** - Two numbers (e.g., UV coordinates, X/Y position)
- **Vec3** - Three numbers (e.g., RGB color, XYZ position)
- **Vec4** - Four numbers (e.g., RGBA color with alpha)

Rhizomium automatically converts between compatible types when possible.

---

## 🔍 Common Patterns

### Pattern 1: UV → Generator → Color → Output

The most basic pattern - create a field and color it.

```
UV → Circle → ColorRamp → Output
```

### Pattern 2: UV → Transform → Generator → Color → Output

Add movement and transformation.

```
UV → Rotate → Voronoi → ColorRamp → Output
```

### Pattern 3: Multiple Fields Combined

Layer multiple patterns together.

```
UV → Circle → \
              Blend → ColorRamp → Output
UV → Noise →  /
```

### Pattern 4: Animated Parameters

Use Time to animate any parameter.

```
Time → Sin → [Parameter Input]
```

---

## 🎯 Next Steps

Congratulations! You've created your first Rhizomium visual. Here's what to explore next:

1. **[Node Reference](node-reference.md)** - Learn about all available nodes
2. **[Parameter Expressions](parameter-expressions.md)** - Create animated parameters with math
3. **[Compute Nodes](compute-nodes.md)** - GPU-accelerated effects and simulations
4. **[Audio Reactivity](audio-web.md)** - Connect visuals to sound
5. **[MIDI Controller Integration](midi.md)** - Control parameters with hardware controllers
6. **[Timeline & Keyframes](timeline.md)** - Create smooth animations
7. **[3D Field Visualization](field-visualization.md)** - Visualize compute outputs in 3D
8. **[Save & Load](save-load-web.md)** - Save your creations

---

## 💬 Tips and Tricks

- **Save frequently** - Use Ctrl+S or the Save button
- **Name your nodes** - Double-click node titles to rename them
- **Organize your graph** - Keep related nodes grouped together
- **Use the preview** - Watch your visual update in real-time
- **Start simple** - Build complexity gradually
- **Experiment freely** - You can always undo (Ctrl+Z)

---

## 🐛 Troubleshooting

### I don't see any output

- Make sure you have an Output node connected
- Check that all required inputs are connected
- Look for error messages in the console (F12)

### My animation is too fast/slow

- Adjust the Time multiplier
- Try values between 0.1 (slow) and 2.0 (fast)

### Colors don't look right

- Check your ColorRamp stops
- Make sure you're feeding appropriate values (usually 0-1 range)
- Try a Clamp node to limit value ranges

### Performance issues

- Reduce the number of complex nodes (Noise, Voronoi)
- Simplify your graph
- Close other browser tabs using GPU

---

_Ready to dive deeper? Check out the [Node Reference](node-reference.md) for a complete catalog of all available nodes._
