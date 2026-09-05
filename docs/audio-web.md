# Audio Reactivity

Make your visuals react to music and sound! Rhizomium includes built-in audio analysis that works directly in your browser.

---

## Quick Start

### Step 1: Turn on the audio

1. Open **Tools → Audio…** (`Cmd/Ctrl+Alt+A`)
2. Pick a source: **File**, **Mic / line-in**, or **System**
3. Load a track and press **Play**, or press **Listen** for a live input
4. The channel meters down the panel start moving

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

Three tabs at the top of the Audio panel. Only one runs at a time — starting a
live input pauses the file.

### File

**Best for**: building a patch against a known track, rehearsing a set

Load an MP3, WAV or OGG, then **Play** / **Pause**. **Stop** returns to the
start, the loop button repeats the track, and the progress bar scrubs.

### Mic / line-in

**Best for**: live performance, an instrument, a room mic

Press **Listen** and allow microphone access, then pick the input from the
device menu. Echo cancellation, noise suppression and auto-gain are all turned
off: they are built for speech, and auto-gain in particular flattens exactly
the loud/quiet difference a threshold discriminates on. Nothing is monitored
back to the speakers, so there is no feedback loop.

### System

**Best for**: Spotify, YouTube, a DJ app — anything already playing

Press **Listen**, then pick a tab, window or screen in the browser's picker and
**tick the share-audio box**. Without that tick the stream arrives with no
audio track at all; the panel says so rather than sitting silently at zero.

What the picker offers depends on the browser and OS — Chrome shows "Share tab
audio" when you pick a tab and "Share system audio" when you pick a screen.
Sharing a tab is the most widely supported; if no audio tick appears for a
whole screen, share the tab instead. Nothing is played back — you still hear it
from its own tab.

No loopback driver, "Stereo Mix" device or third-party routing software is
needed for any of this.

---

## The Audio Panel

![The Audio panel, showing system audio being analysed and the live channel meters](images/panel-audio-envelope.webp)

**Tools → Audio…** (`Cmd/Ctrl+Alt+A`). Top to bottom: the source tabs, the
analysis settings, and a live meter for every channel.

### Settings

| Setting | Range | Default | What it does |
|---------|-------|---------|--------------|
| **Attack** | 1-200 ms | 8 ms | How fast a meter rises — short enough to catch a transient |
| **Release** | 1-2000 ms | 120 ms | How fast it falls — long enough that a hit stays visible for a few frames |
| **Gain** | 0-8 | 1 | How hot the meters read. At 0 every meter is dead |
| **Kick / Snare / Hat Threshold** | 0-1 | 0.5 | Where that drum's trigger fires on its own meter |

Attack and Release change what the meters *look like*, which in turn changes
what a threshold has to be set to. They are not a second detector.

These settings live on the **Audio node**, not in the panel. That makes each one
an ordinary node parameter: MIDI-mappable, drivable by an expression such as
`=midi * 0.6 + 0.2`, undoable, and saved with the patch. With no Audio node in
the graph the analysis runs on the defaults above, and the panel says so and
offers to add one.

### Channels

Every channel the analysis produces, each with a meter showing what it reads
right now:

| Channel | Reads |
|---------|-------|
| **Level**, **Low**, **Mid**, **High** | Overall loudness, and per frequency band |
| **Brightness**, **Noisiness** | Spectral centroid and density |
| **Kick / Snare / Hat Meter** | What that drum's threshold is compared against |
| **Kick / Snare / Hat** | That drum's envelope |
| **Kick / Snare / Hat Trigger** | 1 for a single frame when the drum fires |

The **+** beside a channel drops an **Audio Value** node on the canvas wired to
it — a float you can drag into any parameter. Every tap on a channel reads the
same number the meter shows, which is what makes a threshold findable: watch the
meter, set the threshold above where it idles between hits and below where it
peaks on one, then deploy the trigger.

A threshold set *below* the idle level holds the trigger permanently open, which
produces **fewer** triggers rather than more.

> Expressions and channels are two routes to the same analysis. `audioEnvelope`
> and its band variables are available in any parameter expression; the channels
> above — including the drum triggers, which have no expression variable — are
> reached by deploying an Audio Value node.

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

### Every channel reads 0

**Problem**: the meters sit at zero and the panel's chip says "Not listening"
or "Paused"

Nothing is feeding the analysis — a node reading a channel is not broken, the
patch just has no audio in it. The way out depends on the tab you are on:

**Solutions**:
1. On **File**, load a track and press Play
2. On **Mic / line-in** or **System**, press **Listen**
3. On **System**, check you ticked the share-audio box in the picker — without
   it the stream carries no audio track
4. Check browser permissions for the microphone, and test it in another app
5. Check **Gain** is not at 0, which kills every meter

### Audio Not Reacting

**Problem**: An `=audioEnvelope` expression is set but nothing happens

**Solutions**:
1. Check the panel's meters are moving — if they are not, see above
2. Check the expression starts with `=` and uses a valid variable name
3. Increase **Gain** in the Audio panel
4. Try a different frequency band

### Too Sensitive

**Problem**: Visual reacts too much to audio

**Solutions**:
1. Reduce **Gain** in the Audio panel
2. Increase **Release** so the meters fall more slowly
3. Clamp the expression, e.g. `=clamp(audioEnvelope * 2, 0, 1)`
4. Scale it down, e.g. `=audioEnvelope * 0.5`

### Too Subtle

**Problem**: Barely visible reactions

**Solutions**:
1. Increase **Gain** in the Audio panel
2. Multiply audio value (×2, ×5, ×10)
3. Use different frequency band (Bass often strongest)
4. Check audio source volume

### A drum trigger never fires, or never stops

**Problem**: a Kick / Snare / Hat Trigger channel stays at 0, or sits at 1

Watch that drum's **Meter** row in the panel while the track plays. The
threshold has to sit **above** where the meter idles between hits and **below**
where it peaks on one. Set under the idle level, the trigger is held permanently
open and fires less, not more.

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
