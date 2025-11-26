# Redraw Throttling Policy

**Last Updated**: 2025-01-XX  
**Status**: Active Policy  
**Version**: 1.0

---

## Overview

This document defines the throttling and debouncing strategy for canvas redraws in the GLSL Node Editor. The goal is to cap redraw frequency per trigger type while maintaining responsive user interactions and preventing stale previews.

---

## Design Principles

1. **Per-Trigger-Type Strategy**: Different event types have different throttling requirements
2. **Debounce for Rapid Events**: High-frequency events (mouse move, pan) use debouncing
3. **Throttle for Continuous Updates**: Time-based animations use rate limiting
4. **Priority-Based**: Critical updates (user input) bypass throttling when necessary
5. **Configurable**: All limits are tunable via configuration flags

---

## Trigger Type Classifications

### 1. User Interaction Events (HIGH PRIORITY)

These events require immediate visual feedback but can be throttled during rapid sequences.

| Trigger Type | Strategy | Rate Limit | Debounce Window | Notes |
|-------------|----------|------------|-----------------|-------|
| `mouse-move` | Throttle | 60 FPS (16.67ms) | N/A | During pan/drag operations |
| `mouse-drag` | Throttle | 60 FPS (16.67ms) | N/A | Node dragging, wire dragging |
| `pan` | Throttle | 30 FPS (33.33ms) | N/A | Viewport panning - can skip frames |
| `zoom` | Immediate | N/A | 50ms | Zoom should feel instant, debounce rapid scroll |
| `selection` | Immediate | N/A | N/A | Selection changes must be instant |
| `box-select` | Throttle | 30 FPS (33.33ms) | N/A | Box selection during drag |

**Default Configuration:**
```javascript
{
  'mouse-move': { throttle: 16.67, debounce: null, priority: 'high' },
  'mouse-drag': { throttle: 16.67, debounce: null, priority: 'high' },
  'pan': { throttle: 33.33, debounce: null, priority: 'normal' },
  'zoom': { throttle: null, debounce: 50, priority: 'high' },
  'selection': { throttle: null, debounce: null, priority: 'critical' },
  'box-select': { throttle: 33.33, debounce: null, priority: 'normal' }
}
```

---

### 2. Graph Structure Changes (MEDIUM PRIORITY)

These events occur less frequently but require full redraws.

| Trigger Type | Strategy | Rate Limit | Debounce Window | Notes |
|-------------|----------|------------|-----------------|-------|
| `node-add` | Immediate | N/A | N/A | New nodes must appear immediately |
| `node-remove` | Immediate | N/A | N/A | Deletions must be instant |
| `node-move` | Throttle | 30 FPS (33.33ms) | N/A | During multi-node drag |
| `connection-add` | Immediate | N/A | 100ms | Debounce rapid connection attempts |
| `connection-remove` | Immediate | N/A | N/A | Disconnections must be instant |
| `graph-change` | Debounce | N/A | 150ms | General graph mutations |

**Default Configuration:**
```javascript
{
  'node-add': { throttle: null, debounce: null, priority: 'high' },
  'node-remove': { throttle: null, debounce: null, priority: 'high' },
  'node-move': { throttle: 33.33, debounce: null, priority: 'normal' },
  'connection-add': { throttle: null, debounce: 100, priority: 'normal' },
  'connection-remove': { throttle: null, debounce: null, priority: 'high' },
  'graph-change': { throttle: null, debounce: 150, priority: 'normal' }
}
```

---

### 3. Parameter Updates (MEDIUM PRIORITY)

Parameter changes can be frequent during slider dragging or MIDI input.

| Trigger Type | Strategy | Rate Limit | Debounce Window | Notes |
|-------------|----------|------------|-----------------|-------|
| `parameter-change` | Throttle | 30 FPS (33.33ms) | 200ms | During slider drag, debounce final value |
| `parameter-drag` | Throttle | 30 FPS (33.33ms) | N/A | Continuous parameter adjustment |
| `midi-input` | Throttle | 30 FPS (33.33ms) | 100ms | MIDI CC changes |
| `expression-update` | Debounce | N/A | 300ms | Expression evaluation results |

**Default Configuration:**
```javascript
{
  'parameter-change': { throttle: 33.33, debounce: 200, priority: 'normal' },
  'parameter-drag': { throttle: 33.33, debounce: null, priority: 'normal' },
  'midi-input': { throttle: 33.33, debounce: 100, priority: 'normal' },
  'expression-update': { throttle: null, debounce: 300, priority: 'normal' }
}
```

---

### 4. Preview Updates (LOW-MEDIUM PRIORITY)

Preview computations are expensive and should be throttled aggressively.

| Trigger Type | Strategy | Rate Limit | Debounce Window | Notes |
|-------------|----------|------------|-----------------|-------|
| `preview-update` | Throttle | 15 FPS (66.67ms) | 500ms | Node preview regeneration |
| `preview-compute` | Throttle | 10 FPS (100ms) | 1000ms | Full preview computation |
| `thumbnail-update` | Throttle | 20 FPS (50ms) | 300ms | Thumbnail rendering |

**Default Configuration:**
```javascript
{
  'preview-update': { throttle: 66.67, debounce: 500, priority: 'low' },
  'preview-compute': { throttle: 100, debounce: 1000, priority: 'low' },
  'thumbnail-update': { throttle: 50, debounce: 300, priority: 'low' }
}
```

---

### 5. Animation & Time-Based (VARIABLE PRIORITY)

Time-based updates depend on whether animations are active.

| Trigger Type | Strategy | Rate Limit | Debounce Window | Notes |
|-------------|----------|------------|-----------------|-------|
| `animation-frame` | Throttle | 60 FPS (16.67ms) | N/A | Only when time-based expressions exist |
| `time-update` | Throttle | 60 FPS (16.67ms) | N/A | Continuous time updates |
| `audio-envelope` | Throttle | 30 FPS (33.33ms) | N/A | Audio-reactive updates |

**Default Configuration:**
```javascript
{
  'animation-frame': { throttle: 16.67, debounce: null, priority: 'high' },
  'time-update': { throttle: 16.67, debounce: null, priority: 'high' },
  'audio-envelope': { throttle: 33.33, debounce: null, priority: 'normal' }
}
```

---

### 6. Background & System Events (LOW PRIORITY)

These events can be heavily throttled as they don't require immediate visual feedback.

| Trigger Type | Strategy | Rate Limit | Debounce Window | Notes |
|-------------|----------|------------|-----------------|-------|
| `autosave` | Debounce | N/A | 2000ms | Autosave triggers |
| `background-warmup` | Throttle | 1 FPS (1000ms) | N/A | Background maintenance |
| `worker-message` | Debounce | N/A | 100ms | Worker thread updates |
| `observer-update` | Debounce | N/A | 200ms | MutationObserver triggers |

**Default Configuration:**
```javascript
{
  'autosave': { throttle: null, debounce: 2000, priority: 'idle' },
  'background-warmup': { throttle: 1000, debounce: null, priority: 'idle' },
  'worker-message': { throttle: null, debounce: 100, priority: 'low' },
  'observer-update': { throttle: null, debounce: 200, priority: 'low' }
}
```

---

## Throttling Strategies

### Throttle (Rate Limiting)

**When to use**: Continuous events that need regular updates but not every occurrence.

**Behavior**: 
- Allows execution at most once per time window
- If called multiple times within window, only the last call executes
- Ensures minimum time between executions

**Example**: Mouse move during pan - update viewport every 33ms max (30 FPS)

### Debounce (Delay Execution)

**When to use**: Events that should only execute after a pause in activity.

**Behavior**:
- Delays execution until no new calls for the debounce window
- Resets timer on each new call
- Only executes the final call after activity stops

**Example**: Parameter change - wait 200ms after user stops dragging slider before final update

### Immediate (No Throttling)

**When to use**: Critical user feedback that must be instant.

**Behavior**:
- No throttling or debouncing
- Executes immediately on every call
- Use sparingly for critical interactions

**Example**: Selection changes - must be instant for responsive UI

---

## Priority Levels

| Priority | Description | Bypass Throttle? | Use Case |
|----------|-------------|------------------|----------|
| `critical` | Must execute immediately | Yes | Selection, node add/remove |
| `high` | Important user feedback | No (but high rate limit) | Mouse interactions, animations |
| `normal` | Standard updates | No | Parameter changes, panning |
| `low` | Background updates | No | Preview computations |
| `idle` | Non-urgent maintenance | No | Autosave, warmup |

---

## Configuration Flags

All throttling parameters are configurable via `RedrawThrottleConfig`:

```javascript
{
  // Enable/disable throttling globally
  enabled: true,
  
  // Per-trigger-type configuration
  triggers: {
    'mouse-move': { throttle: 16.67, debounce: null, priority: 'high' },
    // ... other triggers
  },
  
  // Global overrides
  maxFPS: 60,              // Maximum redraws per second (global cap)
  minFrameTime: 16.67,     // Minimum time between redraws (ms)
  
  // Animation loop integration
  respectAnimationLoop: true,  // Coordinate with RAF loop
  skipFramesDuringPan: true,   // Allow frame skipping during pan
  
  // Debugging
  logThrottled: false,     // Log when redraws are throttled
  logStats: false          // Log throttling statistics
}
```

---

## Integration with Animation Loops

### Coordination with requestAnimationFrame

The throttling system coordinates with the main animation loop:

1. **Animation Loop Active**: When time-based animations exist, throttle to 60 FPS max
2. **Static Scene**: When no animations, throttle aggressively (15-30 FPS)
3. **User Interaction**: During interactions, prioritize user events over animations

### Frame Skipping

During panning and other high-frequency interactions:
- Skip rendering frames if viewport transform is already updated
- Render at reduced rate (30 FPS) but maintain smooth transform updates
- Resume full rate when interaction ends

---

## Risk Mitigation

### Over-Throttling Risks

**Problem**: Stale previews, laggy UI, missed updates

**Mitigation**:
- Priority system ensures critical updates bypass throttling
- Debounce windows are conservative (not too long)
- Configuration allows tuning per use case
- Fallback to immediate execution if throttling causes issues

### Animation Loop Coupling

**Problem**: Throttling conflicts with animation loop timing

**Mitigation**:
- `respectAnimationLoop` flag coordinates with RAF
- Separate throttling for animation vs. interaction events
- Animation events use high priority and 60 FPS limit
- Static scenes bypass animation throttling entirely

### Performance Degradation

**Problem**: Throttling overhead exceeds benefits

**Mitigation**:
- Lightweight scheduler implementation
- Minimal overhead per request
- Statistics tracking to measure effectiveness
- Ability to disable per trigger type

---

## Monitoring & Tuning

### Statistics Tracking

The scheduler tracks:
- Total redraw requests per trigger type
- Throttled vs. executed redraws
- Average delay introduced by throttling
- Queue depth during high-frequency events

### Tuning Guidelines

1. **If UI feels laggy**: Reduce throttle times for high-priority triggers
2. **If CPU usage is high**: Increase throttle times for low-priority triggers
3. **If previews are stale**: Reduce debounce windows for preview updates
4. **If animations stutter**: Ensure animation triggers use high priority

---

## Migration Notes

### Existing Code

Existing `markDirty()` calls continue to work but are now throttled:
- No code changes required
- Throttling is transparent to callers
- Can opt-out per call with `{ immediate: true }` option

### Backward Compatibility

- Default configuration matches current behavior (minimal throttling)
- Can disable throttling globally via config
- Per-trigger-type configuration allows fine-tuning

---

## Future Enhancements

1. **Adaptive Throttling**: Adjust rates based on frame time measurements
2. **Quality Levels**: Different throttle rates for different quality settings
3. **Battery-Aware**: Reduce rates on battery-powered devices
4. **Network-Aware**: Adjust for slow network conditions (if applicable)

---

## References

- [Performance Analysis Report](./PERFORMANCE_ANALYSIS.md)
- [Redraw Trigger Detection](./REDRAW_TRIGGER_DETECTION.md)
- [Renderer Implementation](../src/core/Renderer.js)
- [Editor Implementation](../src/core/Editor.js)

