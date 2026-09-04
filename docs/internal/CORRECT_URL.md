# ✅ Correct URL for GPU Tests

## Use This URL:

```
http://localhost:8000/editor/index.html
```

## Why?

- The `/studio` route is a Flask route (doesn't work with simple HTTP server)
- The main application is at `editor/index.html`
- This file loads `main.js` which initializes the GPU device and GPUPerformanceTest
- GPU tests require the GPU device to be initialized first

## Steps:

1. **Open:** `http://localhost:8000/editor/index.html`
2. **Wait** for the application to load (you should see the node editor)
3. **Open browser console** (F12)
4. **Run tests:**
   ```javascript
   await window.gpuPerformanceTest?.runAllTests();
   ```

## Alternative: Use Demo Page

If you prefer the demo page interface:
1. First open: `http://localhost:8000/editor/index.html` (let it load)
2. Then open: `http://localhost:8000/examples/gpu-performance-demo.html` in a new tab
3. Click "Run All Tests" button

---

**Server Status:** ✅ Running on http://localhost:8000

**Correct URL:** http://localhost:8000/editor/index.html

