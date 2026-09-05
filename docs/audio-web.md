# Audio Reactivity

Make your visuals react to music and sound! Rhizomium includes built-in audio analysis that works directly in your browser.

---

## Quick Start

### Step 1: Enable Audio

1. Open **Tools → Audio Settings**
2. Click **Enable Audio Input**
3. Allow microphone access when prompted
4. You should see audio levels responding to sound

### Step 2: Use Audio in Parameter Expressions

Audio reactivity works through **parameter expressions**: type `=` followed by an expression into any numeric parameter field. The audio level is available as the `audioEnvelope` variable:

1. Select a node (e.g. a Circle)
2. Click into a parameter field (e.g. `Radius`)
3. Type `=audioEnvelope * 0.5`

The parameter now follows the audio level every frame. See [Parameter Expressions](parameter-expressions.md) for the full expression syntax.

### Step 3: Pick a Frequency Band

Several audio variables are available in expressions:

- `audioEnvelope` - Overall intensity (smoothed)
- `audioEnvelopeBass` - Low frequencies (kick drums, bass)
- `audioEnvelopeMids` - Middle frequencies (vocals, guitars)
- `audioEnvelopeHighs` - High frequencies (hi-hats, cymbals)
- `audioEnvelopeFull` - Total energy

All values range from **0.0 to 1.0**.

---

## Example Patterns

### Pulsing Circle

Make a circle pulse to the beat — on a Circle node, set:

```
Radius = 0.15 + audioEnvelopeBass * 0.3
```

The circle grows with bass hits!

### Color Changes

Shift colors with different frequencies — on a Color Adjust (compute) node, set:

```
hue = audioEnvelopeMids * 180
```

### Rotation Speed

Control rotation speed with audio — on a Rotate 2D node, set:

```
Rotation = time * (30 + audioEnvelopeHighs * 300)
```

### Multi-Band Visualization

Use all frequency bands on three Circle nodes:

```
Circle 1: Radius = audioEnvelopeBass * 0.4
Circle 2: Radius = audioEnvelopeMids * 0.4
Circle 3: Radius = audioEnvelopeHighs * 0.4
```

---

## Audio Sources

### Microphone

**Best for**: Live performances, singing along, ambient sound

1. Click Audio Settings
2. Enable Audio Input
3. Select your microphone
4. Speak or play music near your mic

### System Audio (Desktop Audio)

**Best for**: Spotify, YouTube, any desktop audio

**Chrome/Edge on Windows:**
1. Audio Settings → Enable Audio Input
2. Select "Stereo Mix" or "What U Hear" as input
3. (May need to enable in Windows Sound settings)

**macOS:**
- Requires additional software (Loopback, BlackHole)
- Or use microphone near speakers

**Linux:**
- Use PulseAudio loopback
- Or use microphone near speakers

---

## Audio Settings Panel

![The Audio panel, showing system audio being analysed and the live channel meters](images/panel-audio-envelope.webp)

### Smoothing
Controls how quickly audio values change:
- **Low (0.1-0.3)**: Responds quickly, more jittery
- **Medium (0.5-0.7)**: Balanced response
- **High (0.8-0.9)**: Smooth, slower response

### Gain
Amplifies audio signal:
- **Low (0.5-1.0)**: Subtle reactions
- **Medium (1.5-2.5)**: Normal sensitivity
- **High (3.0-5.0)**: Extremely sensitive

### Frequency Ranges
Customize which frequencies go to each band (advanced).

---

## Tips for Audio Reactivity

### 1. Use Multipliers

Audio values are 0-1, but you may want larger ranges:

```
=audioEnvelope * 10
```

### 2. Add Offsets

Ensure a minimum value:

```
=0.5 + audioEnvelope * 0.5
```

### 3. Interpolate Between Bounds

Map audio into an exact range:

```
=lerp(0.2, 0.8, audioEnvelope)
```

### 4. Combine Frequencies

Mix different bands:

```
=(audioEnvelopeBass + audioEnvelopeHighs) * 0.5
```

### 5. Gate Quiet Signals

Only react above a threshold:

```
=audioEnvelope > 0.5 ? audioEnvelope : 0
```

---

## Common Patterns

### Reactive Size

```
Circle Radius = 0.1 + audioEnvelopeBass * 0.4
```

### Reactive Speed

```
Rotation = time * (1 + audioEnvelope * 10)
```

### Reactive Complexity

```
Noise Scale = 3 + audioEnvelope * 10
```

### Reactive Position

```
Translate X = audioEnvelopeMids * 0.2
```

### Beat-Reset Feedback

Wire an audio-driven signal through a **Trigger** node into the **Reset** pin of a Compute Feedback node to clear trails on the beat.

---

## Troubleshooting

### No Audio Input

**Problem**: Audio Settings shows "No input detected"

**Solutions**:
1. Refresh the page and allow microphone again
2. Check browser permissions for microphone
3. Test microphone in other apps
4. Try a different browser

### Audio Not Reacting

**Problem**: An `=audioEnvelope` expression is set but nothing happens

**Solutions**:
1. Make sure Audio Settings is enabled
2. Check the expression starts with `=` and uses a valid variable name
3. Check that sound is playing/microphone is receiving audio
4. Increase Gain in Audio Settings
5. Try different frequency bands

### Too Sensitive

**Problem**: Visual reacts too much to audio

**Solutions**:
1. Reduce Gain in Audio Settings
2. Increase Smoothing
3. Clamp the expression, e.g. `=clamp(audioEnvelope * 2, 0, 1)`
4. Scale it down, e.g. `=audioEnvelope * 0.5`

### Too Subtle

**Problem**: Barely visible reactions

**Solutions**:
1. Increase Gain in Audio Settings
2. Multiply audio value (×2, ×5, ×10)
3. Use different frequency band (Bass often strongest)
4. Check audio source volume

---

## Performance Notes

Audio analysis runs in real-time with minimal performance impact:
- **CPU**: ~1-2% usage for audio processing
- **GPU**: No additional load
- **Latency**: <10ms response time

Safe to use even with complex visuals!

---

## Browser Compatibility

| Browser | Audio Support | Notes |
|---------|--------------|-------|
| **Chrome 113+** | Full | Best experience |
| **Edge 113+** | Full | Recommended |
| **Opera** | Full | Works well |
| **Firefox** | Limited | WebGPU issues |
| **Safari** | Limited | WebGPU partial |

---

## Privacy & Security

- **Microphone access** is required for audio reactivity
- Audio is **processed locally** in your browser
- **No data is sent** to any server
- You can revoke microphone permission anytime in browser settings

---

## Next Steps

- **[Node Reference](node-reference.md)** - See all audio-compatible parameters
- **[Performance Tips](performance.md)** - Optimize audio-reactive visuals
- **[FAQ](faq-web.md)** - Common audio questions

---

_Let the beat drive your visuals!_
