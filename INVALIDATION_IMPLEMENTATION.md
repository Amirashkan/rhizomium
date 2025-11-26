# Precise Invalidation Logic Implementation

## Overview

This document describes the implementation of precise invalidation logic that replaces blanket redraws with region/state-based invalidation. The system tracks dirty regions by node/region and provides region merging capabilities to minimize redraw operations.

## Architecture

### Core Components

1. **InvalidationManager** (`src/core/InvalidationManager.js`)
   - Tracks dirty regions keyed by node ID or region identifier
   - Provides region merging to combine overlapping regions
   - Supports full invalidation when too many regions or explicit full redraw is needed

2. **Editor Integration** (`src/core/Editor.js`)
   - Integrates InvalidationManager into the Editor class
   - Provides convenience methods: `invalidateNode()`, `invalidateNodes()`, `invalidateConnection()`
   - Passes precise dirty regions to the renderer

3. **Renderer Updates** (`src/core/Renderer.js`)
   - Supports partial redraws by filtering nodes/connections based on dirty regions
   - Clears only dirty regions instead of the entire canvas when possible
   - Falls back to full redraw when needed

4. **Event Handler Integration**
   - **SelectionManager**: Invalidates nodes when moved during drag operations
   - **ConnectionManager**: Invalidates connection regions when connections are created/removed

## Key Features

### Region Tracking
- Each node/region is tracked with its bounding box (x, y, w, h)
- Regions include padding to account for connections, pins, and visual effects
- Invalidations are keyed by node ID or custom region identifier

### Region Merging
- Overlapping regions are automatically merged into a single bounding box
- Uses a greedy merging algorithm that continues until no more overlaps exist
- Prevents excessive region fragmentation

### Performance Optimizations
- Maximum region limit: When too many regions exist (>50 by default), forces full redraw
- Partial canvas clearing: Only clears dirty regions instead of entire canvas
- Filtered rendering: Only renders nodes/connections that intersect with dirty regions

### Fallback Behavior
- Invalid regions trigger full invalidation
- Full redraw is used when:
  - Explicitly requested via `invalidateFull()`
  - Too many regions exist (exceeds max limit)
  - Invalid region data is provided

## API Usage

### Basic Node Invalidation

```javascript
// Invalidate a single node
editor.invalidateNode(node, 'preview-update');

// Invalidate multiple nodes
editor.invalidateNodes([node1, node2, node3], 'batch-update');

// Invalidate a connection
editor.invalidateConnection(connection, fromNode, toNode, 'connection-created');
```

### Manual Region Invalidation

```javascript
// Invalidate a specific region
editor.invalidationManager.invalidate('region-key', {
  x: 100,
  y: 100,
  w: 200,
  h: 150
}, 'custom-reason');

// Full invalidation
editor.invalidationManager.invalidateFull('viewport-change');
```

### Configuration

```javascript
// Set region padding (default: 20px)
editor.invalidationManager.setRegionPadding(30);

// Set maximum regions before forcing full redraw (default: 50)
editor.invalidationManager.setMaxRegions(100);
```

## Implementation Details

### Region Merging Algorithm

The merging algorithm uses a greedy approach:

1. Start with the first region
2. For each subsequent region:
   - Check if it overlaps with any existing merged region
   - If overlapping, merge into the existing region
   - If not, add as a new region
3. Continue merging until no more overlaps exist

### Partial Redraw Process

1. **Invalidation**: Event handlers mark specific nodes/regions as dirty
2. **Merging**: InvalidationManager merges overlapping regions
3. **Filtering**: Renderer filters nodes/connections that intersect dirty regions
4. **Clearing**: Only dirty regions are cleared on the canvas
5. **Rendering**: Only filtered nodes/connections are rendered

### Canvas API Limitations

The HTML5 Canvas API doesn't support true partial redraws (you can't render to a sub-region without affecting the rest). However, we optimize by:

- Clearing only dirty regions (using `clearRect()`)
- Rendering only nodes/connections that intersect dirty regions
- This reduces the amount of drawing operations even if we can't avoid clearing

## Testing

Comprehensive unit tests are provided in `tests/InvalidationManager.test.js` covering:

- Basic invalidation tracking
- Region merging (overlapping and non-overlapping)
- Multiple node invalidation
- Connection invalidation
- Region normalization
- Max regions limit
- Edge cases (null nodes, zero-size regions, etc.)

Run tests with:
```bash
npm test -- tests/InvalidationManager.test.js
```

## Potential Risks & Mitigations

### Risk: Complexity Causing Bugs
**Mitigation**: 
- Comprehensive unit tests (19 test cases)
- Clear separation of concerns (InvalidationManager is isolated)
- Fallback to full redraw when in doubt

### Risk: Partial Redraw Support Insufficient in GPU Pipeline
**Mitigation**:
- System gracefully falls back to full redraw when needed
- GPU rendering can still benefit from filtered node/connection lists
- Future enhancement: Implement GPU-based partial redraws using render targets

## Future Enhancements

1. **GPU Partial Redraws**: Use WebGPU render targets for true partial redraws
2. **Region Caching**: Cache rendered regions to avoid re-rendering unchanged areas
3. **Adaptive Merging**: Adjust merging strategy based on region density
4. **Viewport-Aware Filtering**: Only invalidate regions visible in viewport

## Files Modified

- `src/core/InvalidationManager.js` (new)
- `src/core/Editor.js` (updated)
- `src/core/Renderer.js` (updated)
- `src/core/SelectionManager.js` (updated)
- `src/core/ConnectionManager.js` (updated)
- `tests/InvalidationManager.test.js` (new)

## Performance Impact

Expected improvements:
- **Reduced redraw time**: Only dirty regions are cleared and rendered
- **Lower CPU usage**: Fewer drawing operations during incremental updates
- **Better frame rates**: Especially noticeable when updating single nodes or small regions

The system maintains backward compatibility - if precise invalidation fails or is unavailable, it falls back to full redraws.

