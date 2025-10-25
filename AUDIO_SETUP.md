# Audio Envelope Setup Instructions

## Windows Setup (Git Bash/MINGW64)

### Step 1: Pull the latest changes

```bash
# Make sure you're in the project root
cd /e/twFFinalPROj/glsl-node-editor

# Pull the latest changes
git pull origin claude/implement-audio-envelope-011CUUbRm6oYS8VPtG7QjFEr

# OR if you're on a different branch
git fetch origin
git checkout claude/implement-audio-envelope-011CUUbRm6oYS8VPtG7QjFEr
```

### Step 2: Install Python dependencies

```bash
# From the project root directory
pip install -r audio/requirements.txt
```

### Step 3: Run the audio server

**IMPORTANT: Run from the project root, NOT from the audio directory!**

```bash
# Make sure you're in the project root
cd /e/twFFinalPROj/glsl-node-editor

# Run with microphone input
python -m audio.audio_server --mode mic

# OR run with desktop audio (loopback)
python -m audio.audio_server --mode loopback
```

### Common Issues

**Issue 1: ModuleNotFoundError**
```
ModuleNotFoundError: No module named 'audio'
```
**Solution:** You're running from the wrong directory. Go back to the project root:
```bash
cd /e/twFFinalPROj/glsl-node-editor
python -m audio.audio_server --mode mic
```

**Issue 2: Missing requirements.txt**
```
ERROR: Could not open requirements file
```
**Solution:** Pull the latest changes first:
```bash
git pull origin claude/implement-audio-envelope-011CUUbRm6oYS8VPtG7QjFEr
```

**Issue 3: No module named 'sounddevice'**
```
ModuleNotFoundError: No module named 'sounddevice'
```
**Solution:** Install dependencies:
```bash
pip install -r audio/requirements.txt
```

**Issue 4: PortAudio library not found (Windows)**
```
OSError: PortAudio library not found
```
**Solution:** sounddevice should include PortAudio. If it doesn't work, try:
```bash
pip uninstall sounddevice
pip install sounddevice --upgrade
```

## macOS/Linux Setup

### Step 1: Pull the latest changes

```bash
cd ~/path/to/glsl-node-editor
git pull origin claude/implement-audio-envelope-011CUUbRm6oYS8VPtG7QjFEr
```

### Step 2: Install Python dependencies

```bash
pip install -r audio/requirements.txt

# OR if you prefer using pip3
pip3 install -r audio/requirements.txt
```

### Step 3: Run the audio server

```bash
# From the project root
python -m audio.audio_server --mode mic

# OR with python3
python3 -m audio.audio_server --mode mic
```

### macOS-specific: Microphone Permissions

If you get permission errors:
1. Go to System Preferences → Security & Privacy → Privacy
2. Select "Microphone" from the left sidebar
3. Enable access for Terminal (or your terminal app)

### Linux-specific: Audio Permissions

If you get permission errors:
```bash
# Add your user to the audio group
sudo usermod -a -G audio $USER

# Log out and log back in for changes to take effect
```

## Verify Installation

Once the server starts successfully, you should see:

```
Audio engine started (mode: mic, rate: 48000Hz)
Audio envelope server running on http://localhost:8765
WebSocket endpoint: ws://localhost:8765/ws
HTTP endpoint: http://localhost:8765/envelope
Update rate: 60 Hz
Press Ctrl+C to stop
```

## Testing the Server

Open your browser and navigate to:
- http://localhost:8765/status

You should see:
```json
{
  "status": "running",
  "clients": 0,
  "mode": "mic",
  "samplerate": 48000
}
```

## Next Steps

1. Keep the audio server running in one terminal
2. Open the GLSL Node Editor in your browser
3. Click "Audio Settings" button
4. You should see "Status: Connected" (green)
5. Make some noise - the value bar should move!

## Troubleshooting

### Server starts but no audio detected

1. **Check your microphone is working:**
   - Windows: Settings → System → Sound → Input device
   - macOS: System Preferences → Sound → Input
   - Linux: `arecord -l` to list devices

2. **Lower the threshold:**
   - Open Audio Settings in the editor
   - Set Follower → Threshold to 0.05 or lower

3. **Test with Python:**
   ```python
   import sounddevice as sd
   print(sd.query_devices())
   ```

### Frontend shows "Disconnected"

1. Make sure the server is running
2. Check browser console for errors (F12)
3. Try refreshing the page
4. Check firewall isn't blocking localhost:8765

### Performance Issues

1. Reduce update rate:
   ```bash
   python -m audio.audio_server --mode mic --rate 30
   ```

2. Increase envelope release times in Audio Settings

## Command Reference

```bash
# Basic usage
python -m audio.audio_server

# All options
python -m audio.audio_server --host localhost --port 8765 --mode mic --rate 60

Options:
  --host HOST    Server host (default: localhost)
  --port PORT    Server port (default: 8765)
  --mode MODE    Audio mode: mic or loopback (default: mic)
  --rate RATE    Update rate in Hz (default: 60)
```

## Support

If you're still having issues:
1. Check the error messages in the terminal
2. Check the browser console (F12)
3. Try running with `--rate 30` for lower CPU usage
4. Make sure Python 3.7+ is installed: `python --version`
