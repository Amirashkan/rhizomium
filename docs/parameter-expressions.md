# Parameter Expressions

Use mathematical expressions to create dynamic, animated parameters that respond to time, audio, and other inputs.

---

## What Are Parameter Expressions?

Parameter expressions let you write **mathematical formulas** instead of static values. They're evaluated in real-time, creating animated and reactive parameters.

**Example:**
- **Static**: `radius: 0.5` (always 0.5)
- **Expression**: `radius: "=sin(time) * 0.3 + 0.5"` (animates between 0.2 and 0.8)

---

## Quick Start

### Step 1: Enable Expression Mode

1. Click on a node to open its parameters panel
2. Click on any parameter input field
3. Type `=` to start an expression

### Step 2: Write Your Expression

Type a mathematical expression after the `=`:

```
=sin(time) * 2
```

### Step 3: See It Animate

The parameter updates in real-time! Watch your visual change as the expression evaluates.

---

## Available Variables

### Time-Based Variables

#### `time`
Current elapsed time in seconds (continuously increasing)

**Examples:**
```
=time                    // Direct time value
=time * 2                // Time at 2x speed
=sin(time)                // Oscillating between -1 and 1
=sin(time * 2) * 0.5 + 0.5  // Oscillating between 0 and 1
```

#### `frame`
Current frame number (increases by 1 each frame)

**Examples:**
```
=frame / 60              // Time in seconds (at 60 FPS)
=mod(frame, 60)          // Frame number modulo 60
```

### Audio Variables

#### `audioEnvelope`
Audio envelope value (0.0 to 1.0) - requires audio input enabled

**Examples:**
```
=audioEnvelope                    // Direct audio value
=audioEnvelope * 5                // Scale audio (0 to 5)
=audioEnvelope * 0.5 + 0.5        // Center around 0.5
```

#### Frequency bands

Per-band envelope values (0.0 to 1.0) are also available:

- `audioEnvelopeBass` - Low frequencies (kick drums, bass)
- `audioEnvelopeMids` - Middle frequencies (vocals, guitars)
- `audioEnvelopeHighs` - High frequencies (hi-hats, cymbals)
- `audioEnvelopeFull` - Total energy

**Examples:**
```
=audioEnvelopeBass * 0.4          // Bass-driven size
=lerp(0.2, 1.0, audioEnvelopeHighs)  // Highs mapped into a range
```

**Note:** Requires audio server running or browser audio enabled. See [Audio Reactivity](audio-web.md).

### Input Variables

#### `mouse.x` / `mouse.y`
Current mouse position (normalized 0-1)

**Examples:**
```
=mouse.x                         // Horizontal mouse position
=mouse.y                         // Vertical mouse position
=mouse.x * 2 - 1                 // Mouse X from -1 to 1
```

#### `uv.x` / `uv.y`
Current UV coordinates (0-1) - only in shader context

**Examples:**
```
=uv.x                            // U coordinate
=uv.y                            // V coordinate
```

### Resolution Variables

#### `resolution.width` / `resolution.height`
Viewport dimensions in pixels

**Examples:**
```
=resolution.width / resolution.height  // Aspect ratio
=resolution.width                      // Width in pixels
```

---

## Mathematical Functions

### Basic Operations

```
=2 + 3                    // Addition: 5
=5 - 2                    // Subtraction: 3
=3 * 4                    // Multiplication: 12
=10 / 2                   // Division: 5
=2 ** 3                   // Power: 8 (2 to the power of 3)
=5 % 2                    // Modulo: 1 (remainder)
```

### Trigonometric Functions

```
=sin(time)                // Sine (returns -1 to 1)
=cos(time)                // Cosine (returns -1 to 1)
=tan(time)                // Tangent
=asin(0.5)                // Arc sine (inverse sine)
=acos(0.5)                // Arc cosine
=atan(0.5)                // Arc tangent
=atan2(y, x)              // Two-argument arc tangent
```

### Exponential & Logarithmic

```
=exp(2)                   // e^2 (natural exponential)
=exp2(3)                  // 2^3
=log(10)                  // Natural logarithm
=log2(8)                  // Base-2 logarithm
=pow(2, 3)                // 2^3 (power function)
```

### Rounding & Absolute

```
=floor(3.7)               // Round down: 3
=ceil(3.2)                 // Round up: 4
=round(3.5)                // Round to nearest: 4
=abs(-5)                   // Absolute value: 5
=fract(3.7)                // Fractional part: 0.7
```

### Min/Max/Clamp

```
=min(5, 3)                 // Minimum: 3
=max(5, 3)                 // Maximum: 5
=clamp(value, 0, 1)        // Clamp between 0 and 1
```

### Interpolation

```
=mix(0, 10, 0.5)           // Linear interpolation: 5
=lerp(0, 10, 0.5)          // Same as mix: 5
=smoothstep(0, 1, 0.5)     // Smooth interpolation: 0.5
```

---

## Common Expression Patterns

### Oscillating Values

**Sine wave oscillation:**
```
=sin(time) * 0.5 + 0.5     // Oscillates between 0 and 1
=sin(time * 2) * 0.3       // Faster oscillation, smaller range
```

**Sawtooth wave:**
```
=fract(time)                // Rises from 0 to 1, then repeats
=fract(time * 2) * 0.5      // Faster, smaller range
```

**Square wave:**
```
=step(0.5, fract(time))     // Alternates between 0 and 1
```

### Rotating Values

**Continuous rotation:**
```
=time * 360                 // Degrees (0 to 360, then repeats)
=fract(time) * 360          // Same, but cleaner
=time * 2 * pi              // Radians (for shader math)
```

**Bounded rotation:**
```
=sin(time) * 45             // Oscillates between -45 and 45 degrees
```

### Audio-Reactive

**Scale with audio:**
```
=audioEnvelope * 10         // Scale audio (0 to 10)
=audioEnvelope * 0.5 + 0.5  // Center around 0.5
```

**Threshold-based:**
```
=audioEnvelope > 0.5 ? 1 : 0  // On/off based on audio level
```

### Mouse-Controlled

**Follow mouse:**
```
=mouse.x                    // Horizontal position (0 to 1)
=mouse.x * 2 - 1            // Horizontal position (-1 to 1)
```

**Distance from center:**
```
=length(mouse.x - 0.5, mouse.y - 0.5)  // Distance from center
```

### Time-Based Animation

**Pulsing:**
```
=sin(time * 2) * 0.3 + 0.7  // Pulses between 0.4 and 1.0
```

**Ramping:**
```
=fract(time / 5)             // Ramp from 0 to 1 over 5 seconds
```

**Delayed start:**
```
=max(0, time - 2)            // Starts at 0, increases after 2 seconds
```

---

## Combining Expressions

### Multiple Operations

```
=sin(time) * cos(time * 2)  // Combine functions
=sin(time) + cos(time) * 0.5 // Add and multiply
```

### Conditional Logic

```
=time > 5 ? 1 : 0           // If time > 5, return 1, else 0
=audioEnvelope > 0.7 ? audioEnvelope : 0  // Gate audio
```

### Nested Expressions

```
=sin(time * (1 + audioEnvelope))  // Audio modulates frequency
=sin(time) * (1 + audioEnvelope)  // Audio modulates amplitude
```

---

## Tips & Tricks

### Performance

- **Cache static parts**: `=sin(time) * 2` is faster than `=sin(time * 2)`
- **Avoid complex expressions**: Keep expressions simple for better performance
- **Use built-in functions**: Prefer `sin()` over custom implementations

### Debugging

- **Start simple**: Test with `=time` first, then add complexity
- **Check values**: Use the parameter panel to see evaluated values
- **Browser console**: Check for expression errors (F12)

### Best Practices

1. **Use parentheses** for clarity: `=(sin(time) + 1) * 0.5`
2. **Comment complex expressions** in your notes
3. **Test edge cases**: What happens at time=0? At very large values?
4. **Combine with MIDI**: Use expressions for base values, MIDI for live control

---

## Expression Examples

### Animated Circle Radius

```
=sin(time * 2) * 0.2 + 0.3   // Pulses between 0.1 and 0.5
```

### Audio-Reactive Scale

```
=audioEnvelope * 5 + 5        // Scales from 5 to 10 with audio
```

### Mouse-Controlled Position

```
=mouse.x * 2 - 1              // X position from -1 to 1
=mouse.y * 2 - 1              // Y position from -1 to 1
```

### Rotating Pattern

```
=time * 90                    // Rotates 90 degrees per second
```

### Breathing Effect

```
=sin(time * 0.5) * 0.1 + 0.9  // Slow breathing (0.8 to 1.0)
```

### Strobe Effect

```
=step(0.5, fract(time * 10))  // Fast strobe (10 flashes per second)
```

---

## Troubleshooting

### Expression Not Working

**Problem:** Parameter shows error or doesn't update

**Solutions:**
- Check syntax (missing `=` at start?)
- Verify function names are correct
- Check variable names (`time`, not `Time`)
- Look for typos in expression
- Check browser console for errors (F12)

### Expression Too Slow

**Problem:** Performance drops with expressions

**Solutions:**
- Simplify the expression
- Reduce function calls
- Cache repeated calculations
- Use simpler math operations

### Wrong Values

**Problem:** Expression evaluates but values seem wrong

**Solutions:**
- Check units (degrees vs radians)
- Verify range (expression might exceed parameter limits)
- Test with simple values first (`=time`)
- Check for division by zero

### Audio Variable Not Available

**Problem:** `audioEnvelope` always returns 0

**Solutions:**
- Enable audio input in Audio Settings
- Check audio server is running (if using external server)
- Verify audio permissions granted
- Test with `=time` first to verify expressions work

---

## Advanced Usage

### Node References

Reference other node outputs in expressions:

```
=node_1_value               // Reference node 1's output
=node_2_x                   // Reference node 2's X component
```

**Note:** This feature may vary by node type and connection.

### Custom Functions

Some advanced expressions support custom functions:

```
=lerp(0, 10, sin(time))     // Interpolate with sine
=smoothstep(0, 1, time)      // Smooth transition
```

---

## See Also

- [MIDI Controller Integration](midi.md) - Combine expressions with MIDI
- [Timeline Animation](timeline.md) - Keyframe animation system
- [Audio Reactivity](audio-web.md) - Audio input and expressions
- [Compute Nodes](compute-nodes.md) - Expressions in compute shaders

