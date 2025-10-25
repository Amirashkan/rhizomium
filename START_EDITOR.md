# How to Start the GLSL Node Editor

## Quick Start (Windows)

You need to run TWO things in separate terminals:

### Terminal 1: Audio Server (Already Running! ✅)
```bash
python -m audio.audio_server --mode mic
```

### Terminal 2: Web Server for Editor

Open a **NEW** Git Bash terminal and run ONE of these options:

#### Option 1: Using Python (Easiest)
```bash
cd /e/twFFinalPROj/glsl-node-editor
python -m http.server 8080
```

Then open in browser:
```
http://localhost:8080/editor/
```

#### Option 2: Using Node.js
```bash
cd /e/twFFinalPROj/glsl-node-editor
npx http-server -p 8080
```

Then open in browser:
```
http://localhost:8080/editor/
```

#### Option 3: Using Live Server (VS Code)
If you have VS Code with Live Server extension:
1. Open the project in VS Code
2. Right-click on `editor/index.html`
3. Select "Open with Live Server"

---

## Testing the Audio Envelope

Once the editor is open:

### 1. Click "Audio Settings" Button
Look for the button in the top menu bar (HUD)

### 2. Check Connection
You should see:
- **Status: Connected** (green text)
- **Value: 0.000** (will change with audio)
- A green progress bar

### 3. Test Audio Input
- Make some noise (talk, clap, play music)
- Watch the value and bar change
- If nothing happens, lower the **Threshold** slider to 0.05

### 4. Create an Audio-Reactive Node
Try this simple test:

1. **Right-click** on the canvas to open the node menu
2. Select **Input → ConstFloat** or any **CircleField** node
3. Click on the node to open its parameter panel
4. Find a numeric parameter (like `value` or `radius`)
5. Type: `=audioEnvelope * 5.0`
6. Press **Enter**

The value should now pulse with your audio! 🎵

### More Examples:

**Scale value:**
```
=audioEnvelope * 10
```

**Smooth range:**
```
=lerp(1.0, 5.0, audioEnvelope)
```

**Combine with time:**
```
=sin(time) * audioEnvelope
```

**Inverted:**
```
=1.0 - audioEnvelope
```

---

## Troubleshooting

### "I can't access the editor"
- Make sure you're running a web server (python -m http.server 8080)
- Check you're going to `http://localhost:8080/editor/` (note the `/editor/` path)
- Try a different port if 8080 is busy: `python -m http.server 8081`

### "Audio Settings shows Disconnected"
- Make sure the audio server is running in the other terminal
- Refresh the browser page
- Check browser console (F12) for errors
- Verify the audio server is on port 8765

### "Value stays at 0.000"
- Make noise into your microphone
- Lower the Threshold slider in Audio Settings
- Check Windows microphone permissions
- Verify the correct microphone is selected in Windows settings

### "Parameters don't update"
- Make sure you prefix with `=` (e.g., `=audioEnvelope`)
- Press Enter after typing the expression
- Check the expression result display shows a green checkmark

---

## Full Workflow

**Terminal 1:**
```bash
cd /e/twFFinalPROj/glsl-node-editor
python -m audio.audio_server --mode mic
# Keep this running
```

**Terminal 2:**
```bash
cd /e/twFFinalPROj/glsl-node-editor
python -m http.server 8080
# Keep this running too
```

**Browser:**
```
http://localhost:8080/editor/
```

Both servers need to stay running while you work!

---

## Stopping Everything

1. Press **Ctrl+C** in Terminal 1 (audio server)
2. Press **Ctrl+C** in Terminal 2 (web server)
3. Close the browser tab

That's it! Enjoy creating audio-reactive visuals! 🎨🎵
