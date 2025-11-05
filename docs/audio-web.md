# Audio Reactivity

Make your visuals react to music and sound! Rhizomium includes built-in audio analysis that works directly in your browser.

---

## Quick Start

### Step 1: Enable Audio

1. Click the **Audio Settings** button in the toolbar
2. Click **Enable Audio Input**
3. Allow microphone access when prompted
4. You should see audio levels responding to sound

### Step 2: Add Audio Node

1. Right-click on canvas
2. **Input → Audio**
3. Place the Audio node in your graph

### Step 3: Connect to Parameters

The Audio node outputs different frequency bands:

- **Bass** - Low frequencies (kick drums, bass)
- **Mid** - Middle frequencies (vocals, guitars)
- **High** - High frequencies (hi-hats, cymbals)
- **Overall** - Combined intensity

Connect these to any node parameter to make it react!

---

## Audio Node Outputs

```
[Audio Node]
├─ Bass     (Low frequencies 20-250 Hz)
├─ Mid      (Mid frequencies 250-4000 Hz)
├─ High     (High frequencies 4000-20000 Hz)
└─ Overall  (Total energy)
```

All outputs range from **0.0 to 1.0**.

---

## Example Patterns

### Pulsing Circle

Make a circle pulse to the beat:

```
UV → Circle → ColorRamp → Output
Audio (Bass) → Circle (radius)
```

The circle grows with bass hits!

### Color Changes

Change colors with different frequencies:

```
UV → Circle → ColorRamp → Output
Audio (Mid) → ColorRamp (position shift)
```

### Rotation Speed

Control rotation speed with audio:

```
UV → Rotate → Circle → Output
Audio (High) → Rotate (angle)
```

### Multi-Band Visualization

Use all frequency bands:

```
Audio (Bass) → Circle 1 (radius)
Audio (Mid) → Circle 2 (radius)
Audio (High) → Circle 3 (radius)
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
Audio (Bass) → Multiply (×10) → Parameter
```

### 2. Add Offsets

Ensure a minimum value:

```
Audio (Mid) → Add (0.5) → Parameter
```

### 3. Smooth Motion

Use math to smooth transitions:

```
Audio → Smoothstep → Parameter
```

### 4. Combine Frequencies

Mix different bands:

```
Audio (Bass) → Mix (A) ┐
Audio (High) → Mix (B) ┘→ Parameter
```

### 5. Remap Ranges

Scale audio to your desired range:

```
Audio → Remap (0-1 to 0.2-0.8) → Parameter
```

---

## Common Patterns

### Reactive Colors

```
Audio → ColorRamp input → Shifts colors with music
```

### Reactive Size

```
Audio → Circle/Shape radius → Grows with beat
```

### Reactive Speed

```
Audio → Time multiplier → Faster animation
```

### Reactive Complexity

```
Audio → Noise scale → More detail with sound
```

### Reactive Position

```
Audio → Transform offset → Movement with music
```

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

**Problem**: Audio node connected but nothing happens

**Solutions**:
1. Make sure Audio Settings is enabled
2. Check that sound is playing/microphone is receiving audio
3. Increase Gain in Audio Settings
4. Try different frequency bands

### Too Sensitive

**Problem**: Visual reacts too much to audio

**Solutions**:
1. Reduce Gain in Audio Settings
2. Increase Smoothing
3. Add a Clamp node to limit range
4. Use multiply node with value < 1.0

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
| **Chrome 113+** | ✅ Full | Best experience |
| **Edge 113+** | ✅ Full | Recommended |
| **Opera** | ✅ Full | Works well |
| **Firefox** | ⚠️ Limited | WebGPU issues |
| **Safari** | ⚠️ Limited | WebGPU partial |

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

_Let the beat drive your visuals!_ 🎵
