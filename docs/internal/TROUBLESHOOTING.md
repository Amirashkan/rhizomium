# Editor Not Loading - Troubleshooting Guide

## Problem: "Only menu shows, no canvas"

Follow these steps:

### Step 1: Check Browser Console

1. Press **F12** to open Developer Tools
2. Click the **Console** tab
3. Look for **RED error messages**

**Take a screenshot or copy the errors and share them**

Common errors and fixes:

#### Error: "WebGPU not supported"
```
Solution: Use Chrome, Edge, or a WebGPU-compatible browser
Chrome: chrome://flags - Enable "Unsafe WebGPU"
```

#### Error: "Failed to load module" or "404 Not Found"
```
Solution: Make sure you're running the server from the project ROOT
cd rhizomium
python -m http.server 8080
Then go to: http://localhost:8080/editor/index.html
```

### Step 2: Check What You See

Describe exactly what's on the screen:
- [ ] Dark/black canvas area (good!)
- [ ] Only white/gray background
- [ ] Menu bar at top (should be there)
- [ ] Nothing except menu buttons

### Step 3: Try Right-Clicking

**Right-click** in the middle of the page (below the menu)

What happens?
- [ ] A menu pops up with "Search nodes..." (GOOD - editor is working!)
- [ ] Nothing happens (editor not initialized)
- [ ] Context menu from browser (canvas not capturing clicks)

### Step 4: Check Browser Compatibility

**WebGPU Required!** This editor uses WebGPU.

**Compatible browsers:**
- ✅ Chrome 113+ (Recommended)
- ✅ Edge 113+
- ✅ Opera 99+
- ❌ Firefox (WebGPU not enabled by default)
- ❌ Safari (limited support)

**Enable WebGPU in Chrome:**
1. Go to: `chrome://flags`
2. Search for: "WebGPU"
3. Enable: "Unsafe WebGPU"
4. Restart Chrome

### Step 5: Check the Network Tab

1. Press **F12** → **Network** tab
2. Reload the page
3. Look for RED files (404 errors)

**All these should load successfully (200 status):**
- main.js
- Editor.js
- gpuRenderer.js
- All files in src/ folder

If you see 404 errors, the server isn't running from the correct directory.

### Step 6: Verify Server is Running Correctly

In your terminal, you should see:
```
Serving HTTP on :: port 8080 (http://[::]:8080/) ...
```

**When you load the page**, you should see requests in the terminal like:
```
::1 - - [date] "GET /editor/index.html HTTP/1.1" 200 -
::1 - - [date] "GET /editor/main.js HTTP/1.1" 200 -
::1 - - [date] "GET /src/core/Editor.js HTTP/1.1" 200 -
```

If you see **404** errors in the terminal, the paths are wrong.

---

## Quick Checklist

Run through this checklist:

### Terminal 1 (Audio Server)
```bash
cd rhizomium
python -m audio.audio_server --mode mic
```
✅ Should show: "Audio envelope server running on http://localhost:8765"

### Terminal 2 (Web Server)
```bash
cd rhizomium
python -m http.server 8080
```
✅ Should show: "Serving HTTP on :: port 8080"

### Browser
1. Open: `http://localhost:8080/editor/index.html`
2. Press **F12** → Check Console for errors
3. **Right-click** on canvas → Should see node menu

---

## Common Solutions

### Solution 1: Clear Browser Cache
```
Ctrl + Shift + Delete → Clear cache and reload
Or try Incognito/Private mode
```

### Solution 2: Check Windows Path Issues
On Windows, symbolic links don't work well. Make sure you're accessing:
```
http://localhost:8080/editor/index.html
```
NOT:
```
http://localhost:8080/editor/  (might not load scripts)
```

### Solution 3: Try a Different Browser
Download Chrome Canary or Edge Dev for latest WebGPU support:
- Chrome Canary: https://www.google.com/chrome/canary/
- Edge Dev: https://www.microsoft.com/en-us/edge/download/insider

### Solution 4: Check Firewall/Antivirus
Sometimes antivirus blocks localhost servers. Try:
- Temporarily disable antivirus
- Allow Python through Windows Firewall

---

## Still Not Working?

**Provide this information:**

1. **Browser + Version**: (e.g., Chrome 120)
2. **Console Errors**: (Copy all RED errors from F12 console)
3. **Network Status**: (Any 404 errors in F12 → Network tab?)
4. **What you see**: (Screenshot or description)
5. **Right-click test**: (Does menu appear?)

---

## Expected Behavior (When Working)

When everything works correctly:

1. **Page loads** → Dark canvas with grid pattern
2. **Menu bar** → Buttons at top (Toggle Preview, Save, Audio Settings, etc.)
3. **Right-click** → Popup menu with "Search nodes..."
4. **Create node** → Node appears on canvas
5. **Audio Settings button** → Opens panel showing "Connected" status
6. **Browser console** → No red errors

If you see all of this, the editor is working! 🎉
