# Deployment Notes

## External Viewer Limitations

### ⚠️ Important: External Viewer is Local-Only

The **"Open External Viewer"** feature is designed for **local development only** and will **NOT work** when deployed to cloud platforms like:

- Vercel
- Netlify
- GitHub Pages
- Any other static hosting service

### Why It Doesn't Work on Cloud Platforms

The external viewer requires:

1. **Python Backend**: Must run `rhizo_server.py` or `viewer_api.py` locally
2. **Process Spawning**: Needs to launch `rhizo_viewer.py` as a desktop application
3. **Shared Memory IPC**: Uses local shared memory for frame streaming
4. **Desktop Display**: Opens an OpenGL window on your local machine

None of these are possible in a cloud/static hosting environment.

## Deployment Scenarios

### ✅ What DOES Work on Vercel/Netlify/etc.

- **Node Editor** - Full visual shader programming interface
- **WebGPU Rendering** - Real-time GPU rendering in the browser
- **Save/Load Projects** - Project management
- **Audio Reactivity** - Audio envelope integration
- **Code Export** - WGSL/JSON export

### ❌ What DOES NOT Work on Cloud Hosting

- **External Viewer** - Requires local Python backend
- **IPC Frame Streaming** - Requires local shared memory

## Recommended Setup

### For Development (Full Features)

Run locally with the Python backend:

```bash
# Clone the repository
git clone <repo-url>
cd glsl-node-editor

# Install dependencies
pip install -r requirements.txt

# Start the integrated server
python rhizo_server.py

# Open in browser
# http://127.0.0.1:5000/studio
```

✅ All features work, including external viewer

### For Production/Demo (Web Only)

Deploy to Vercel/Netlify for public access:

```bash
# Deploy with Vercel CLI
vercel deploy
```

✅ Node editor and rendering work
❌ External viewer is disabled (button shows tooltip)

## User Experience

### On Cloud Hosting (Vercel/Netlify)

When users click "Open External Viewer":
- Button appears dimmed (opacity: 0.6)
- Tooltip shows: "External viewer requires local Python server"
- Click shows alert with setup instructions
- No 404 errors logged

### On Local Server

When users click "Open External Viewer":
- If backend running: Viewer launches successfully
- If backend not running: Shows setup instructions
- Clear error messages guide user to run `rhizo_server.py`

## Auto-Detection

The UI automatically detects the hosting environment:

```javascript
const isCloudHosted =
  window.location.hostname.includes('vercel.app') ||
  window.location.hostname.includes('netlify.app') ||
  window.location.hostname.includes('github.io') ||
  (!window.location.hostname.includes('localhost') &&
   !window.location.hostname.includes('127.0.0.1'));
```

## Future Enhancements

Potential ways to support external viewing in cloud deployments:

1. **WebSocket Streaming** - Stream frames over WebSocket instead of shared memory
2. **WebRTC** - Peer-to-peer connection for frame streaming
3. **Browser-Based Viewer** - Secondary browser window instead of desktop app
4. **Cloud Rendering** - Server-side rendering with video streaming

These would require significant architecture changes.

## Summary

| Feature | Local Server | Cloud Hosting |
|---------|-------------|---------------|
| Node Editor | ✅ | ✅ |
| WebGPU Rendering | ✅ | ✅ |
| Save/Load | ✅ | ✅ |
| Audio Reactivity | ✅ | ✅ |
| Code Export | ✅ | ✅ |
| **External Viewer** | **✅** | **❌** |

For the full development experience with external viewer support, always run locally with `python rhizo_server.py`.
