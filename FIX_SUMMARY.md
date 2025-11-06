# Fix for Node Menu Selection Issue

## Problem
Nodes created from right-click menu don't appear until you click again.

## Root Cause
`updateShaderFromGraph()` only updates the GPU shader, it does NOT call `editor.draw()` to redraw the canvas.

## Solution

### File: `editor/src/ui/RadialMenu.js`

**Find this function (around line 877):**

```javascript
_createNode(kind) {
  const node = makeNode(kind, this.canvasPos.x, this.canvasPos.y);
  this.graph.nodes.push(node);
  this.graph.selection = new Set([node.id]);

  // Delay onChange to allow GPU state to settle and prevent bind group mismatch
  setTimeout(() => {
    if (this.onChange) this.onChange();
  }, 50);

  this.hide();
}
```

**Replace with:**

```javascript
_createNode(kind) {
  const node = makeNode(kind, this.canvasPos.x, this.canvasPos.y);
  this.graph.nodes.push(node);
  this.graph.selection = new Set([node.id]);

  // Record node creation for undo
  if (window.onNodeCreated && typeof window.onNodeCreated === 'function') {
    window.onNodeCreated(node);
  }

  // CRITICAL: Hide menu FIRST so it doesn't cover the canvas
  this.hide();

  // Then redraw canvas immediately so node appears
  if (window.editor && typeof window.editor.draw === 'function') {
    if (typeof window.editor.markDirty === 'function') {
      window.editor.markDirty('node-creation');
    }
    window.editor.draw();
  }

  // Delay onChange to allow GPU state to settle and prevent bind group mismatch
  setTimeout(() => {
    if (this.onChange) this.onChange();
  }, 50);
}
```

## What Changed
1. Added `onNodeCreated()` call for undo system
2. Call `this.hide()` FIRST to remove menu overlay
3. Call `editor.markDirty()` and `editor.draw()` immediately to render the node
4. Keep the 50ms delay for `onChange()` (shader compilation)

## Result
Nodes now appear immediately when selected from the right-click menu without requiring an extra click.
