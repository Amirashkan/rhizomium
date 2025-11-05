# Installation & Setup

This guide covers everything you need to know to install and set up Rhizomium on your local machine.

---

## 📋 System Requirements

### Browser Requirements

Rhizomium requires a **WebGPU-capable browser**:

- ✅ **Chrome** 113 or later
- ✅ **Edge** 113 or later
- ✅ **Opera** (with WebGPU enabled)
- ❌ Firefox (WebGPU support in progress)
- ❌ Safari (WebGPU support in progress)

**Check your browser:**
Visit [webgpu.io](https://webgpu.io/) to verify WebGPU support.

### Hardware Requirements

- **GPU**: Any modern GPU with WebGPU support
  - NVIDIA: GTX 900 series or newer
  - AMD: RX 400 series or newer
  - Intel: Iris Xe or newer
  - Apple Silicon: M1 or newer

- **RAM**: 4GB minimum, 8GB recommended
- **OS**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)

### Software Requirements

For local development/server:

- **Python**: 3.8 or later
- **pip**: Python package manager (included with Python)
- **Git**: For cloning the repository (optional)

---

## 🚀 Quick Installation

### Option 1: Cloud Access (Easiest)

No installation required! Access Rhizomium directly:

**Live Demo**: [https://studio.tenderworld.org/](https://studio.tenderworld.org/)

**Note**: Some features like the External Viewer require local installation.

### Option 2: Local Installation (Recommended)

#### Step 1: Clone or Download

**Via Git:**
```bash
git clone https://github.com/Amirashkan/glsl-node-editor.git
cd glsl-node-editor
```

**Via Download:**
1. Visit the [GitHub repository](https://github.com/Amirashkan/glsl-node-editor)
2. Click "Code" → "Download ZIP"
3. Extract to your desired location
4. Open terminal in the extracted folder

#### Step 2: Install Python Dependencies

```bash
pip install -r requirements.txt
```

**What gets installed:**
- `flask` - Web server
- `flask-cors` - Cross-origin support
- `pillow` - Image processing
- Additional dependencies for external viewer

#### Step 3: Start the Server

**Linux/Mac:**
```bash
./START_SERVER.sh
```

**Windows:**
```batch
START_SERVER.bat
```

**Manual Start (all platforms):**
```bash
python rhizo_server.py
```

#### Step 4: Open in Browser

Navigate to: **http://127.0.0.1:5000/studio**

You should see the Rhizomium node editor!

---

## 🔧 Alternative Server Options

### Using Python's Built-in Server

```bash
python -m http.server 8000
```

Then visit: **http://localhost:8000**

**Note**: External viewer features won't work without `rhizo_server.py`.

### Using Node.js Serve

```bash
npx serve .
```

**Note**: External viewer features won't work without running `viewer_api.py` separately.

---

## 🎮 Verifying Your Installation

### Check 1: Web Server

Visit the main page: **http://127.0.0.1:5000/**

You should see the Rhizomium landing page.

### Check 2: Node Editor

Visit: **http://127.0.0.1:5000/studio**

You should see:
- Node editor canvas
- Toolbar with controls
- Right-click menu to add nodes
- Preview window

### Check 3: WebGPU Support

Open browser console (F12) and check for errors:
- ✅ No "WebGPU not supported" messages
- ✅ Canvas renders without errors

### Check 4: Server API (Optional)

Visit: **http://127.0.0.1:5000/api/health**

You should see:
```json
{
  "status": "healthy",
  "timestamp": "..."
}
```

---

## 🐛 Troubleshooting Installation

### Issue: "Python not found"

**Problem**: Python is not installed or not in PATH.

**Solution**:
1. Download Python from [python.org](https://www.python.org/downloads/)
2. During installation, check "Add Python to PATH"
3. Restart your terminal
4. Verify: `python --version`

### Issue: "pip: command not found"

**Problem**: pip is not installed or not in PATH.

**Solution**:
```bash
# Download get-pip.py
curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py

# Install pip
python get-pip.py
```

### Issue: "Module not found" errors

**Problem**: Dependencies not installed correctly.

**Solution**:
```bash
# Upgrade pip first
python -m pip install --upgrade pip

# Reinstall dependencies
pip install -r requirements.txt --force-reinstall
```

### Issue: "Permission denied" (Linux/Mac)

**Problem**: Script doesn't have execute permissions.

**Solution**:
```bash
chmod +x START_SERVER.sh
./START_SERVER.sh
```

### Issue: "Address already in use"

**Problem**: Port 5000 is already taken.

**Solution**:

**Option A - Kill existing process:**
```bash
# Linux/Mac
lsof -ti:5000 | xargs kill -9

# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

**Option B - Use different port:**
Edit `rhizo_server.py` and change the port:
```python
app.run(host='0.0.0.0', port=5001)  # Changed from 5000
```

### Issue: "WebGPU not supported"

**Problem**: Browser doesn't support WebGPU.

**Solution**:
1. Update your browser to the latest version
2. Try Chrome or Edge (best support)
3. Check GPU drivers are up to date
4. Visit [webgpu.io](https://webgpu.io/) to test support

### Issue: Black screen in editor

**Problem**: GPU initialization failed.

**Solution**:
1. Check browser console (F12) for errors
2. Try refreshing the page
3. Restart the browser
4. Update GPU drivers
5. Try a different browser

---

## 🌐 Network Access

### Accessing from Other Devices

By default, Rhizomium binds to `0.0.0.0`, making it accessible from other devices on your network.

**Find your local IP:**

**Windows:**
```batch
ipconfig
```
Look for "IPv4 Address"

**Linux/Mac:**
```bash
ifconfig | grep "inet "
```
or
```bash
ip addr show
```

**Access from other device:**
```
http://YOUR_LOCAL_IP:5000/studio
```

Example: `http://192.168.1.100:5000/studio`

### Security Considerations

**Important**:
- Only allow network access on trusted networks
- The server has no authentication by default
- Consider using a firewall for production use

---

## 📦 Project Structure

After installation, your directory should look like:

```
rhizomium/
├── rhizo_server.py          # Main server with integrated API
├── rhizo_viewer.py          # External viewer application
├── GPUCanvas.py             # GPU renderer with IPC
├── START_SERVER.sh          # Linux/Mac startup script
├── START_SERVER.bat         # Windows startup script
├── requirements.txt         # Python dependencies
├── index.html               # Landing page
├── editor/                  # Editor interface (legacy)
│   └── index.html
├── src/                     # Source modules
│   ├── core/               # Core engine
│   ├── ui/                 # User interface
│   ├── data/               # Node definitions
│   ├── audio/              # Audio processing
│   └── gpu/                # WebGPU rendering
├── docs/                   # Documentation
└── saves/                  # Saved projects (created on first save)
```

---

## 🔄 Updating Rhizomium

### If installed via Git:

```bash
git pull origin main
pip install -r requirements.txt --upgrade
```

### If downloaded as ZIP:

1. Download the latest version
2. Extract to a new location
3. Copy your `saves/` folder from the old installation
4. Reinstall dependencies: `pip install -r requirements.txt`

---

## 🎯 Next Steps

Now that you have Rhizomium installed:

1. **[Quick Start Guide](quickstart.md)** - Learn the basics
2. **[Your First Graph](guide.md)** - Create your first visual
3. **[External Viewer Setup](external-viewer.md)** - Multi-display output
4. **[Audio Setup](audio.md)** - Connect to audio input

---

## 💡 Tips for Best Performance

### Development Mode

For development with auto-reload:
```bash
# Install Flask in development mode
export FLASK_ENV=development
python rhizo_server.py
```

### Production Mode

For better performance:
```bash
# Use production server (gunicorn)
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 rhizo_server:app
```

### Browser Optimization

- Close unnecessary tabs
- Disable browser extensions during use
- Use hardware acceleration (usually enabled by default)
- Keep GPU drivers updated

---

## 📞 Getting Help

Having trouble with installation?

- **[Troubleshooting Guide](troubleshooting.md)** - Common issues
- **[Windows-Specific Fixes](windows-fix.md)** - Windows issues
- **[FAQ](faq.md)** - Frequently asked questions
- **GitHub Issues**: [Report a bug](https://github.com/Amirashkan/glsl-node-editor/issues)

---

_Installation complete? Head to the [Quick Start guide](quickstart.md) to begin creating!_
