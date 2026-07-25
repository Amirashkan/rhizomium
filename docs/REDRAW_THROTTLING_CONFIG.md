# Redraw Throttling Configuration Reference

**Last Updated**: 2025-01-XX  
**Status**: Configuration Guide  
**Version**: 1.0

---

## Overview

This document provides a complete reference for configuring the redraw throttling system. The throttling system can be configured globally or per-trigger-type to optimize performance while maintaining responsive user interactions.

---

## Quick Start

### Basic Configuration

Set global configuration before Editor initialization:

```javascript
// Set global configuration
window.redrawThrottleConfig = {
  enabled: true,
  maxFPS: 60,
  logThrottled: false
};

// Editor will use this configuration automatically
const editor = new Editor(graph, onChange);
```

### Disable Throttling

```javascript
window.redrawThrottleConfig = {
  enabled: false
};
```

### Enable Debug Logging

```javascript
window.redrawThrottleConfig = {
  enabled: true,
  logThrottled: true,  // Log when redraws are throttled
  logStats: true       // Log throttling statistics
};
```

---

## Configuration Options

### Global Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable throttling globally |
| `maxFPS` | `number` | `60` | Maximum redraws per second (global cap) |
| `minFrameTime` | `number` | `16.67` | Minimum time between redraws (ms), auto-calculated from maxFPS |
| `respectAnimationLoop` | `boolean` | `true` | Coordinate with requestAnimationFrame |
| `skipFramesDuringPan` | `boolean` | `true` | Allow frame skipping during panning |
| `logThrottled` | `boolean` | `false` | Log when redraws are throttled (console) |
| `logStats` | `boolean` | `false` | Log throttling statistics periodically |

### Per-Trigger Configuration

Each trigger type can be configured individually in the `triggers` object:

```javascript
window.redrawThrottleConfig = {
  enabled: true,
  triggers: {
    'mouse-move': {
      throttle: 16.67,      // ms - rate limit (null = no throttle)
      debounce: null,       // ms - debounce window (null = no debounce)
      priority: 'high'      // 'critical' | 'high' | 'normal' | 'low' | 'idle'
    },
    'pan': {
      throttle: 33.33,      // 30 FPS during panning
      debounce: null,
      priority: 'normal'
    },
    'parameter-change': {
      throttle: 33.33,      // 30 FPS during drag
      debounce: 200,        // 200ms debounce after drag ends
      priority: 'normal'
    }
  }
};
```

#### Trigger Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `throttle` | `number \| null` | Varies | Rate limit in milliseconds (null = no throttle) |
| `debounce` | `number \| null` | Varies | Debounce window in milliseconds (null = no debounce) |
| `priority` | `string` | Varies | Priority level: 'critical', 'high', 'normal', 'low', 'idle' |

---

## Configuration Examples

### Example 1: Performance Mode (Aggressive Throttling)

Optimize for lower CPU usage:

```javascript
window.redrawThrottleConfig = {
  enabled: true,
  maxFPS: 30,  // Lower global cap
  triggers: {
    'mouse-move': { throttle: 33.33, debounce: null, priority: 'normal' },
    'pan': { throttle: 50, debounce: null, priority: 'normal' },
    'preview-update': { throttle: 100, debounce: 1000, priority: 'low' },
    'background-warmup': { throttle: 2000, debounce: null, priority: 'idle' }
  }
};
```

### Example 2: Responsive Mode (Minimal Throttling)

Prioritize responsiveness over performance:

```javascript
window.redrawThrottleConfig = {
  enabled: true,
  maxFPS: 60,
  triggers: {
    'mouse-move': { throttle: 16.67, debounce: null, priority: 'high' },
    'pan': { throttle: 16.67, debounce: null, priority: 'high' },
    'parameter-change': { throttle: 16.67, debounce: 100, priority: 'high' },
    'preview-update': { throttle: 33.33, debounce: 200, priority: 'normal' }
  }
};
```

### Example 3: Animation-Focused

Optimize for smooth animations:

```javascript
window.redrawThrottleConfig = {
  enabled: true,
  maxFPS: 60,
  respectAnimationLoop: true,
  triggers: {
    'animation-frame': { throttle: 16.67, debounce: null, priority: 'high' },
    'time-update': { throttle: 16.67, debounce: null, priority: 'high' },
    'preview-update': { throttle: 66.67, debounce: 500, priority: 'low' },
    'background-warmup': { throttle: 2000, debounce: null, priority: 'idle' }
  }
};
```

### Example 4: Disable Specific Triggers

Disable throttling for specific triggers while keeping it enabled globally:

```javascript
window.redrawThrottleConfig = {
  enabled: true,
  triggers: {
    'selection': { throttle: null, debounce: null, priority: 'critical' },
    'node-add': { throttle: null, debounce: null, priority: 'critical' },
    'node-remove': { throttle: null, debounce: null, priority: 'critical' }
  }
};
```

---

## Runtime Configuration

### Update Configuration After Initialization

```javascript
// Get the scheduler from the renderer
const scheduler = editor.renderer.getScheduler();

// Update configuration
scheduler.updateConfig({
  maxFPS: 30,
  logThrottled: true
});

// Update specific trigger
scheduler.updateConfig({
  triggers: {
    'pan': { throttle: 50, debounce: null, priority: 'normal' }
  }
});
```

### Enable/Disable Throttling

```javascript
const scheduler = editor.renderer.getScheduler();

// Disable throttling
scheduler.setEnabled(false);

// Re-enable throttling
scheduler.setEnabled(true);
```

---

## Using requestRedraw() Directly

You can use `Renderer.requestRedraw()` directly for fine-grained control:

```javascript
// Request redraw with specific trigger type
editor.renderer.requestRedraw('parameter-change', {
  reason: 'Slider dragged',
  immediate: false  // Use throttling
});

// Bypass throttling for critical updates
editor.renderer.requestRedraw('selection', {
  reason: 'Node selected',
  immediate: true  // Bypass throttling
});
```

### Options for requestRedraw()

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `immediate` | `boolean` | `false` | Bypass throttling (for critical updates) |
| `reason` | `string` | `triggerType` | Human-readable reason for debugging |
| `region` | `string` | `'general'` | Dirty region identifier |
| `callback` | `function` | `null` | Callback to execute when redraw is approved |

---

## Bypassing Throttling in markDirty()

You can bypass throttling for specific `markDirty()` calls:

```javascript
// Normal call (uses throttling)
editor.markDirty('parameter-change', 'previews');

// Bypass throttling
editor.markDirty('parameter-change', 'previews', {
  useThrottling: false,
  immediate: true
});
```

---

## Monitoring & Statistics

### Get Throttling Statistics

```javascript
const scheduler = editor.renderer.getScheduler();
const stats = scheduler.getStats();

console.log('Total requests:', stats.totalRequests);
console.log('Executed:', stats.executed);
console.log('Throttled:', stats.throttled);
console.log('Debounced:', stats.debounced);
console.log('Throttle rate:', stats.throttleRate.toFixed(2) + '%');
console.log('By trigger:', stats.byTrigger);
```

### Statistics Object

```javascript
{
  totalRequests: 1234,
  executed: 856,
  throttled: 234,
  debounced: 144,
  throttleRate: 18.96,      // Percentage
  debounceRate: 11.67,      // Percentage
  executionRate: 69.37,     // Percentage
  averageDelay: 2.34,       // ms
  byTrigger: {
    'mouse-move': {
      requests: 456,
      executed: 234,
      throttled: 178,
      debounced: 44
    },
    // ... other triggers
  }
}
```

### Reset Statistics

```javascript
const scheduler = editor.renderer.getScheduler();
scheduler.resetStats();
```

---

## Debugging

### Enable Debug Logging

```javascript
window.redrawThrottleConfig = {
  enabled: true,
  logThrottled: true,   // Log when redraws are throttled
  logStats: true        // Log statistics periodically
};
```

### Console Output

With `logThrottled: true`, you'll see:
```
[RedrawScheduler] Throttled mouse-move (16.67ms)
[RedrawScheduler] Throttled pan (33.33ms)
[RedrawScheduler] Throttled parameter-change (global rate limit)
```

### Access Scheduler for Debugging

```javascript
// Make scheduler globally available
window.redrawScheduler = editor.renderer.getScheduler();

// Check current configuration
console.log(window.redrawScheduler.config);

// Check throttle state
console.log(window.redrawScheduler.throttleState);

// Check pending debounce timers
console.log(window.redrawScheduler.debounceTimers);
```

---

## Default Trigger Configurations

See [REDRAW_THROTTLING_POLICY.md](./REDRAW_THROTTLING_POLICY.md) for complete default configurations per trigger type.

### Quick Reference

| Trigger Type | Default Throttle | Default Debounce | Priority |
|-------------|------------------|------------------|----------|
| `mouse-move` | 16.67ms | None | high |
| `pan` | 33.33ms | None | normal |
| `zoom` | None | 50ms | high |
| `selection` | None | None | critical |
| `parameter-change` | 33.33ms | 200ms | normal |
| `preview-update` | 66.67ms | 500ms | low |
| `animation-frame` | 16.67ms | None | high |
| `background-warmup` | 1000ms | None | idle |

---

## Best Practices

1. **Start with Defaults**: The default configuration is balanced for most use cases
2. **Monitor Statistics**: Use `getStats()` to identify bottlenecks
3. **Tune Gradually**: Adjust one trigger at a time and measure impact
4. **Preserve Critical Paths**: Keep `selection`, `node-add`, `node-remove` as immediate
5. **Test Interactions**: Verify UI responsiveness after configuration changes
6. **Use Debug Logging**: Enable `logThrottled` to see what's being throttled

---

## Troubleshooting

### UI Feels Laggy

**Solution**: Reduce throttle times for high-priority triggers
```javascript
triggers: {
  'mouse-move': { throttle: 8.33, debounce: null, priority: 'high' },
  'pan': { throttle: 16.67, debounce: null, priority: 'high' }
}
```

### CPU Usage Still High

**Solution**: Increase throttle times for low-priority triggers
```javascript
triggers: {
  'preview-update': { throttle: 100, debounce: 1000, priority: 'low' },
  'background-warmup': { throttle: 2000, debounce: null, priority: 'idle' }
}
```

### Previews Appear Stale

**Solution**: Reduce debounce windows for preview updates
```javascript
triggers: {
  'preview-update': { throttle: 50, debounce: 200, priority: 'normal' }
}
```

### Animations Stutter

**Solution**: Ensure animation triggers use high priority and 60 FPS
```javascript
triggers: {
  'animation-frame': { throttle: 16.67, debounce: null, priority: 'high' },
  'time-update': { throttle: 16.67, debounce: null, priority: 'high' }
}
```

---

## References

- [Redraw Throttling Policy](./REDRAW_THROTTLING_POLICY.md) - Detailed policy documentation
- [Renderer Implementation](https://github.com/Amirashkan/glsl-node-editor/blob/main/src/core/Renderer.js) - Renderer with requestRedraw()
- [RedrawScheduler Implementation](https://github.com/Amirashkan/glsl-node-editor/blob/main/src/core/RedrawScheduler.js) - Scheduler implementation
- [Editor Implementation](https://github.com/Amirashkan/glsl-node-editor/blob/main/src/core/Editor.js) - Editor integration

