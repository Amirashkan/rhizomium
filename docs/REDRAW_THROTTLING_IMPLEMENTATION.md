# Redraw Throttling Implementation Summary

**Last Updated**: 2025-01-XX  
**Status**: Implementation Complete  
**Version**: 1.0

---

## Overview

This document summarizes the implementation of the redraw throttling strategy for the GLSL Node Editor. The system provides per-trigger-type throttling and debouncing to cap redraw frequency while maintaining responsive user interactions.

---

## Implementation Components

### 1. RedrawScheduler (`src/core/RedrawScheduler.js`)

**Purpose**: Core throttling and debouncing engine

**Features**:
- Per-trigger-type configuration (throttle, debounce, priority)
- Global rate limiting (max FPS cap)
- Priority-based execution (critical updates bypass throttling)
- Statistics tracking (requests, throttled, debounced, execution rates)
- requestAnimationFrame integration
- Configurable at runtime

**Key Methods**:
- `requestRedraw(triggerType, options)` - Request a throttled redraw
- `setRedrawCallback(callback)` - Set callback to execute when redraw approved
- `getStats()` - Get throttling statistics
- `updateConfig(config)` - Update configuration at runtime
- `setEnabled(enabled)` - Enable/disable throttling

### 2. Renderer Integration (`src/core/Renderer.js`)

**Changes**:
- Added `RedrawScheduler` instance to Renderer
- Added `requestRedraw(triggerType, options)` method
- Added `setRedrawCallback(callback)` method
- Added `getScheduler()` method for configuration access
- Added `updateSchedulerConfig(config)` method
- Added `destroy()` method for cleanup

**Usage**:
```javascript
// Request throttled redraw
renderer.requestRedraw('mouse-move', {
  reason: 'Mouse moved',
  immediate: false
});

// Get scheduler for configuration
const scheduler = renderer.getScheduler();
scheduler.updateConfig({ maxFPS: 30 });
```

### 3. Editor Integration (`src/core/Editor.js`)

**Changes**:
- Modified `markDirty()` to use scheduler when enabled
- Added `_internalMarkDirty()` for immediate marking (bypasses throttling)
- Added `_scheduledMarkDirty()` for scheduler callbacks
- Added `_getSchedulerConfig()` for configuration retrieval
- Renderer initialization now includes scheduler setup

**Backward Compatibility**:
- Existing `markDirty()` calls continue to work
- Throttling is transparent to callers
- Can opt-out per call with `{ useThrottling: false }`

**Usage**:
```javascript
// Normal call (uses throttling if enabled)
editor.markDirty('parameter-change', 'previews');

// Bypass throttling
editor.markDirty('parameter-change', 'previews', {
  useThrottling: false
});
```

---

## Configuration

### Global Configuration

Set before Editor initialization:

```javascript
window.redrawThrottleConfig = {
  enabled: true,
  maxFPS: 60,
  respectAnimationLoop: true,
  skipFramesDuringPan: true,
  logThrottled: false,
  logStats: false,
  triggers: {
    // Per-trigger configuration
    'mouse-move': { throttle: 16.67, debounce: null, priority: 'high' },
    'pan': { throttle: 33.33, debounce: null, priority: 'normal' },
    // ... see REDRAW_THROTTLING_CONFIG.md for full list
  }
};
```

### Runtime Configuration

```javascript
const scheduler = editor.renderer.getScheduler();
scheduler.updateConfig({
  maxFPS: 30,
  logThrottled: true
});
```

---

## Trigger Types

The system supports throttling for the following trigger types:

### User Interaction Events
- `mouse-move`, `mouse-drag`, `pan`, `zoom`, `selection`, `box-select`

### Graph Structure Changes
- `node-add`, `node-remove`, `node-move`, `connection-add`, `connection-remove`, `graph-change`

### Parameter Updates
- `parameter-change`, `parameter-drag`, `midi-input`, `expression-update`

### Preview Updates
- `preview-update`, `preview-compute`, `thumbnail-update`

### Animation & Time-Based
- `animation-frame`, `time-update`, `audio-envelope`

### Background & System Events
- `autosave`, `background-warmup`, `worker-message`, `observer-update`

See [REDRAW_THROTTLING_POLICY.md](./REDRAW_THROTTLING_POLICY.md) for complete trigger configurations.

---

## Throttling Strategies

### Throttle (Rate Limiting)
- Allows execution at most once per time window
- Example: Mouse move during pan - update every 33ms max (30 FPS)

### Debounce (Delay Execution)
- Delays execution until no new calls for the debounce window
- Example: Parameter change - wait 200ms after user stops dragging

### Immediate (No Throttling)
- No throttling or debouncing
- Used for critical updates (selection, node add/remove)

---

## Priority Levels

| Priority | Description | Bypass Throttle? |
|----------|-------------|------------------|
| `critical` | Must execute immediately | Yes |
| `high` | Important user feedback | No (but high rate limit) |
| `normal` | Standard updates | No |
| `low` | Background updates | No |
| `idle` | Non-urgent maintenance | No |

---

## Statistics & Monitoring

### Get Statistics

```javascript
const scheduler = editor.renderer.getScheduler();
const stats = scheduler.getStats();

console.log('Total requests:', stats.totalRequests);
console.log('Throttle rate:', stats.throttleRate.toFixed(2) + '%');
console.log('By trigger:', stats.byTrigger);
```

### Statistics Include
- Total requests per trigger type
- Throttled vs. executed redraws
- Debounced redraws
- Average delay introduced
- Execution rates

---

## Risk Mitigation

### Over-Throttling
- **Mitigation**: Priority system ensures critical updates bypass throttling
- **Mitigation**: Conservative debounce windows
- **Mitigation**: Configurable per trigger type

### Animation Loop Coupling
- **Mitigation**: `respectAnimationLoop` flag coordinates with RAF
- **Mitigation**: Separate throttling for animation vs. interaction events
- **Mitigation**: Animation events use high priority and 60 FPS limit

### Performance Degradation
- **Mitigation**: Lightweight scheduler implementation
- **Mitigation**: Minimal overhead per request
- **Mitigation**: Statistics tracking to measure effectiveness
- **Mitigation**: Ability to disable per trigger type

---

## Testing

### Enable Debug Logging

```javascript
window.redrawThrottleConfig = {
  enabled: true,
  logThrottled: true,
  logStats: true
};
```

### Monitor Statistics

```javascript
// Check throttling effectiveness
const stats = editor.renderer.getScheduler().getStats();
console.log('Throttle rate:', stats.throttleRate + '%');
console.log('Execution rate:', stats.executionRate + '%');
```

### Verify Responsiveness

1. Test critical interactions (selection, node add/remove) - should be instant
2. Test high-frequency interactions (pan, drag) - should be smooth but throttled
3. Test parameter changes - should be responsive with debounce on final value
4. Test preview updates - should be throttled but not stale

---

## Migration Guide

### Existing Code

No code changes required! Existing `markDirty()` calls continue to work:

```javascript
// This still works - now uses throttling if enabled
editor.markDirty('parameter-change', 'previews');
```

### Opt-Out Per Call

```javascript
// Bypass throttling for specific calls
editor.markDirty('critical-update', 'general', {
  useThrottling: false
});
```

### Disable Globally

```javascript
window.redrawThrottleConfig = {
  enabled: false
};
```

---

## Files Modified

1. **src/core/RedrawScheduler.js** (NEW) - Core throttling engine
2. **src/core/Renderer.js** - Added `requestRedraw()` and scheduler integration
3. **src/core/Editor.js** - Modified `markDirty()` to use scheduler

## Documentation Created

1. **docs/REDRAW_THROTTLING_POLICY.md** - Policy document with rate limits and debounce windows
2. **docs/REDRAW_THROTTLING_CONFIG.md** - Configuration reference guide
3. **docs/REDRAW_THROTTLING_IMPLEMENTATION.md** - This summary document

---

## Next Steps

1. **Test in Production**: Monitor statistics and adjust configuration as needed
2. **Tune Per Use Case**: Adjust throttle/debounce values based on user feedback
3. **Monitor Performance**: Use statistics to identify bottlenecks
4. **Consider Adaptive Throttling**: Future enhancement to adjust rates based on frame time

---

## References

- [Redraw Throttling Policy](./REDRAW_THROTTLING_POLICY.md) - Detailed policy documentation
- [Configuration Reference](./REDRAW_THROTTLING_CONFIG.md) - Complete configuration guide
- [Performance Analysis](./PERFORMANCE_ANALYSIS.md) - Original performance analysis
- [Redraw Trigger Detection](./REDRAW_TRIGGER_DETECTION.md) - Trigger detection documentation

