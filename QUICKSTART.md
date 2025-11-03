# Rhizomium Quick Start Guide

## 🚀 Quick Start (3 Steps)

### Step 1: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 2: Start the Server

**Option A - Using Startup Script:**

**Linux/Mac:**
```bash
./START_SERVER.sh
```

**Windows:**
```batch
START_SERVER.bat
```

**Option B - Manual Start:**
```bash
python rhizo_server.py
```

### Step 3: Open the Editor

Open your browser and navigate to:
```
http://127.0.0.1:5000/studio
```

## 🎨 Using the External Viewer

Once the editor is open:

1. Click **"Open External Viewer"** button in the toolbar
2. The viewer window will open automatically
3. Start rendering in the editor to see frames in the viewer

## 📋 Common Issues

### ❌ "Failed to launch external viewer: 404"

**Problem:** The server is not running.

**Solution:** Start the server using `python rhizo_server.py` or the startup scripts.

### ❌ "Waiting for stream" in viewer

**Problem:** GPUCanvas is not sending frames.

**Solution:**
- Make sure you're rendering in the main editor
- Check that GPUCanvas.py is integrated with your render loop
- For testing, run `python GPUCanvas.py` in a separate terminal

### ❌ Import errors

**Problem:** Dependencies not installed.

**Solution:**
```bash
pip install -r requirements.txt
```

## 📂 Project Structure

```
rhizomium/
├── rhizo_server.py          ← Integrated web server + API
├── rhizo_viewer.py          ← External viewer application
├── GPUCanvas.py             ← GPU renderer with IPC
├── ipc_protocol.py          ← IPC protocol definitions
├── ipc_shared.py            ← Shared memory channel
├── viewer_api.py            ← Standalone API server (optional)
├── editor/                  ← Editor UI files
│   └── index.html
├── main.js                  ← Main editor logic
└── requirements.txt         ← Python dependencies
```

## 🔧 Advanced Usage

### Running Components Separately

**Terminal 1 - Server:**
```bash
python rhizo_server.py
```

**Terminal 2 - GPU Renderer (for testing):**
```bash
python GPUCanvas.py
```

**Terminal 3 - External Viewer (manual launch):**
```bash
python rhizo_viewer.py
```

### Using the Standalone API Server

If you already have a web server running, use the standalone API:

```bash
python viewer_api.py
```

This runs the API on port 5000 without serving static files.

## 🌐 URLs

- **Landing Page:** http://127.0.0.1:5000/
- **Editor:** http://127.0.0.1:5000/studio
- **Editor (alternate):** http://127.0.0.1:5000/editor
- **Health Check:** http://127.0.0.1:5000/api/health
- **Server Status:** http://127.0.0.1:5000/api/status

## 📖 Further Reading

- [RHIZOMIUM_VIEWER_SETUP.md](RHIZOMIUM_VIEWER_SETUP.md) - Detailed viewer setup and architecture
- [START_EDITOR.md](START_EDITOR.md) - Editor documentation (if exists)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Detailed troubleshooting guide

## 🎯 Next Steps

1. ✅ Start the server
2. ✅ Open the editor in your browser
3. ✅ Create some nodes
4. ✅ Click "Open External Viewer"
5. 🎨 Start creating generative art!

---

**Need help?** Check the troubleshooting guide or open an issue on GitHub.
