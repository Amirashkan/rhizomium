# Timeline & Keyframe Animation

Create smooth, professional animations by setting keyframes for any parameter. Perfect for VJ performances, music videos, and animated visuals.

---

## What is the Timeline?

The Timeline lets you **record parameter changes over time** and play them back automatically. Set keyframes at different times, and Rhizomium smoothly interpolates between them.

**Use cases:**
- Animated transitions
- Synchronized visuals to music
- VJ performances
- Music video effects
- Parameter automation

---

## Quick Start

### Step 1: Open the Timeline

1. Choose **View → Timeline** (or press `Ctrl+T`)
2. The timeline panel appears at the bottom of the screen

### Step 2: Enable Timeline Mode

1. Click the **Enable Timeline** toggle in the timeline panel
2. The timeline is now active and recording

### Step 3: Add a Keyframe

1. **Set the playhead** to your desired time (e.g., 2 seconds)
2. **Click on a node** to select it
3. **Adjust a parameter** (e.g., change Radius from 0.3 to 0.7)
4. **Click "Add Keyframe"** (or press `K`)
5. A keyframe is created at the current time!

### Step 4: Play Animation

1. Click the **Play** button (▶) in the timeline
2. Watch your parameter animate smoothly between keyframes!

---

## Timeline Interface

### Playback Controls

- **⏮ Rewind** - Jump to start
- **⏪ Step Back** - Move back one frame
- **⏸ Pause** - Pause playback
- **▶ Play** - Start playback
- **⏩ Step Forward** - Move forward one frame
- **⏭ Fast Forward** - Jump to end

### Timeline Ruler

Shows time in seconds:
- **Current Time** - Where the playhead is
- **Duration** - Total timeline length (default: 10 seconds)
- **Loop Region** - Highlighted area that loops

### Track List

Shows all animated parameters:
- **Node Name** - Which node is animated
- **Parameter Name** - Which parameter
- **Keyframes** - Visual markers on the timeline

### Keyframe Display

Keyframes appear as **diamonds** on the timeline:
- **Selected** - Highlighted in yellow
- **Unselected** - White/gray
- **Position** - Shows exact time

---

## Creating Animations

### Method 1: Record Mode

**Automatic keyframe creation:**

1. Enable **Record Mode** (red circle button)
2. Click Play
3. Adjust parameters while timeline plays
4. Keyframes are created automatically!

**Best for:** Live performance, improvisation

### Method 2: Manual Keyframes

**Precise control:**

1. Set playhead to start time (e.g., 0 seconds)
2. Set parameter value (e.g., Radius = 0.3)
3. Click "Add Keyframe"
4. Move playhead to end time (e.g., 5 seconds)
5. Set parameter value (e.g., Radius = 0.7)
6. Click "Add Keyframe"
7. Play to see smooth transition!

**Best for:** Precise animations, synchronized effects

### Method 3: Copy/Paste Keyframes

**Reuse animations:**

1. Select keyframes (click and drag)
2. Copy (Ctrl+C)
3. Move playhead to new time
4. Paste (Ctrl+V)

---

## Keyframe Interpolation

### Interpolation Types

Choose how values transition between keyframes:

#### Linear
Straight-line interpolation (default)

**Use for:** Mechanical movements, constant speed

#### Ease In
Starts slow, ends fast

**Use for:** Objects accelerating

#### Ease Out
Starts fast, ends slow

**Use for:** Objects decelerating

#### Ease In-Out
Slow start and end, fast middle

**Use for:** Natural, smooth movements

#### Step
Instant change (no interpolation)

**Use for:** On/off switches, discrete changes

#### Bezier
Custom curve control

**Use for:** Advanced, custom timing

### Changing Interpolation

1. Select a keyframe
2. Right-click (or use interpolation menu)
3. Choose interpolation type
4. Changes apply to the segment after the keyframe

---

## Timeline Settings

### Duration

Set total timeline length:
- **Default**: 10 seconds
- **Range**: 1 second to 60 seconds
- **Change**: Click duration field, enter new value

### Frame Rate

Set playback frame rate:
- **Default**: 60 FPS
- **Options**: 24, 30, 60 FPS
- **Note**: Higher FPS = smoother but more CPU intensive

### Loop

Enable/disable looping:
- **Loop On**: Timeline repeats when reaching end
- **Loop Off**: Timeline stops at end
- **Loop Region**: Set custom loop start/end times

### Snap to Frames

Snap keyframes to frame boundaries:
- **Enabled**: Keyframes align to frame grid
- **Disabled**: Free placement (sub-frame precision)

---

## Working with Multiple Parameters

### Multiple Tracks

You can animate **multiple parameters simultaneously**:

1. Add keyframes for Parameter A
2. Add keyframes for Parameter B (same or different node)
3. Both animate together when playing!

### Track Organization

- **Group by Node**: See all parameters for one node together
- **Show/Hide Tracks**: Click eye icon to hide tracks
- **Solo Track**: Click solo icon to show only one track

---

## Advanced Techniques

### Synchronized Animations

**Sync multiple parameters:**

1. Set playhead to same time for all parameters
2. Add keyframes for all parameters
3. They'll animate in sync!

### Staggered Animations

**Create cascading effects:**

1. Parameter A: Keyframe at 0s
2. Parameter B: Keyframe at 0.5s
3. Parameter C: Keyframe at 1s
4. Creates a wave/cascade effect

### Looping Animations

**Create seamless loops:**

1. Set start keyframe (e.g., Radius = 0.3 at 0s)
2. Set end keyframe (e.g., Radius = 0.7 at 5s)
3. Enable Loop
4. Animation repeats seamlessly!

### Combining with Expressions

**Mix keyframes with expressions:**

- Use keyframes for overall shape
- Use expressions for fine details
- Example: Keyframe controls scale, expression adds jitter

---

## Editing Keyframes

### Moving Keyframes

1. **Click and drag** keyframe horizontally (changes time)
2. **Click and drag** keyframe vertically (changes value - if supported)
3. **Snap**: Hold Shift while dragging to snap to grid

### Deleting Keyframes

1. **Select keyframe** (click on it)
2. **Press Delete** (or right-click → Delete)
3. Keyframe removed, interpolation recalculated

### Copying Keyframes

1. **Select keyframes** (click and drag, or Ctrl+Click)
2. **Copy** (Ctrl+C)
3. **Move playhead** to new time
4. **Paste** (Ctrl+V)

### Scaling Time

**Stretch/compress animation:**

1. Select multiple keyframes
2. Drag edge handles
3. Animation speeds up or slows down

---

## Timeline Playback

### Playback Speed

Control playback speed:
- **1x** - Normal speed
- **0.5x** - Half speed (slower)
- **2x** - Double speed (faster)
- **Custom** - Set any speed multiplier

### Scrubbing

**Manual playback:**
- **Click timeline ruler** to jump to time
- **Drag playhead** to scrub through animation
- **Preview** animation while dragging

### Playback Modes

- **Play Once** - Play from start to end, then stop
- **Loop** - Repeat continuously
- **Ping-Pong** - Play forward, then backward
- **Bounce** - Play forward, bounce at end

---

## Saving Animations

### With Projects

Timeline data is **automatically saved** with projects:
- Save project (Ctrl+S) includes all keyframes
- Load project restores timeline and keyframes
- No separate save needed!

### Export Animation

**Export keyframe data:**
1. File → Export → Animation Data
2. Saves as JSON file
3. Can be imported into other projects

---

## Tips & Tricks

### Performance

- **Limit keyframes**: Too many keyframes can slow playback
- **Simplify curves**: Use linear interpolation when possible
- **Disable unused tracks**: Hide tracks you're not using

### Workflow

1. **Plan first**: Sketch out timing before adding keyframes
2. **Start simple**: Add basic keyframes, refine later
3. **Use markers**: Add timeline markers for important moments
4. **Test frequently**: Play animation often to check progress

### Synchronization

- **Use markers**: Mark beat drops, chorus starts, etc.
- **Snap to grid**: Enable snap for precise timing
- **Count frames**: Calculate frame numbers for exact sync

---

## Common Animation Patterns

### Fade In/Out

**Smooth appearance:**

1. Start: Opacity = 0 at 0s
2. End: Opacity = 1 at 2s
3. Use Ease In-Out interpolation

### Pulse

**Rhythmic pulsing:**

1. Keyframe 1: Scale = 1.0 at 0s
2. Keyframe 2: Scale = 1.2 at 0.5s
3. Keyframe 3: Scale = 1.0 at 1s
4. Enable Loop

### Rotation

**Continuous rotation:**

1. Start: Rotation = 0° at 0s
2. End: Rotation = 360° at 5s
3. Use Linear interpolation
4. Enable Loop for continuous spin

### Color Transition

**Smooth color change:**

1. Start: Color = Red at 0s
2. End: Color = Blue at 3s
3. Use Ease In-Out for smooth transition

---

## Troubleshooting

### Keyframes Not Playing

**Problem:** Animation doesn't play

**Solutions:**
- Check Timeline is enabled (toggle on)
- Verify playhead is moving
- Check keyframes exist on timeline
- Ensure parameter track is visible
- Check playback isn't paused

### Animation Too Fast/Slow

**Problem:** Animation speed feels wrong

**Solutions:**
- Adjust playback speed multiplier
- Check frame rate setting
- Verify keyframe times are correct
- Adjust interpolation type

### Keyframes Disappear

**Problem:** Keyframes vanish when moving playhead

**Solutions:**
- Check track visibility (eye icon)
- Verify keyframes weren't deleted
- Check timeline zoom level
- Reload project if needed

### Jittery Animation

**Problem:** Animation stutters or jumps

**Solutions:**
- Increase frame rate
- Reduce number of keyframes
- Check CPU/GPU performance
- Simplify interpolation curves
- Close other applications

---

## Keyboard Shortcuts

- **Space** - Play/Pause
- **K** - Add keyframe at current time
- **← →** - Move playhead left/right
- **Ctrl+Z** - Undo keyframe change
- **Ctrl+Y** - Redo
- **Delete** - Delete selected keyframe
- **Ctrl+C** - Copy keyframes
- **Ctrl+V** - Paste keyframes

---

## See Also

- [Parameter Expressions](parameter-expressions.md) - Combine with keyframes
- [MIDI Controller Integration](midi.md) - Record MIDI movements as keyframes
- [Performance Tips](performance.md) - Optimize timeline playback

