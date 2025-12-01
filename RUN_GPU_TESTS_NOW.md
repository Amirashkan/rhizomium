# 🚀 Run GPU Tests Now - Quick Guide

## ✅ Server is Running!

The HTTP server has been started on port 8000.

## 📋 Next Steps:

### 1. Open in Browser

Open one of these URLs in your browser:

**Option A: Main Application (Recommended for GPU Tests)**
```
http://localhost:8000/editor/index.html
```

**Option B: GPU Performance Demo**
```
http://localhost:8000/examples/gpu-performance-demo.html
```
*Note: Demo page requires main application to be loaded first*

**Option C: Direct File**
- Navigate to: `examples/gpu-performance-demo.html`
- Open directly (file:// protocol works too)

### 2. Run Tests

**Using the Demo Page (Easiest):**
1. Open `http://localhost:8000/examples/gpu-performance-demo.html`
2. Click the **"Run All Tests"** button
3. Results will appear on the page

**Using Browser Console:**
1. Open any of the URLs above
2. Press **F12** to open Developer Console
3. Run this command:
   ```javascript
   await window.gpuPerformanceTest?.runAllTests();
   ```

### 3. View Results

Results will show:
- ✅ Profiler Display Test
- ✅ Field Mapping Test  
- ✅ Scene Graph Stability Test
  - Command buffer synchronization
  - Memory leak detection
  - Command buffer stall detection
  - Error recovery

## 🔧 Troubleshooting

### If GPUPerformanceTest is not found:

**Option 1: Use Diagnostic Page**
1. Open: `http://localhost:8000/check-gpu-init.html`
2. Click "Check GPU Status"
3. If device exists but test doesn't, click "Try Initialize GPU Test"

**Option 2: Manual Initialization (in console)**
```javascript
// Check if device is available
console.log('Device:', window.gpuRenderer?.device);

// If device exists, manually initialize test
if (window.gpuRenderer?.device && !window.gpuPerformanceTest) {
  const { GPUPerformanceTest } = await import('./src/test/GPUPerformanceTest.js');
  window.gpuPerformanceTest = new GPUPerformanceTest(window.gpuRenderer.device);
  console.log('✅ GPU Test initialized!');
}
```

**Option 3: Deploy to Vercel (Recommended)**
- Vercel provides HTTPS (required for WebGPU)
- Proper headers configured automatically
- See `DEPLOY_TO_VERCEL_FOR_TESTS.md` for instructions

### If tests don't run:

**Check WebGPU Support:**
```javascript
// In browser console
console.log('WebGPU:', navigator.gpu !== undefined);
```

**Enable WebGPU (if needed):**
- Chrome/Edge: Go to `chrome://flags/#enable-unsafe-webgpu`
- Enable "Unsafe WebGPU"
- Restart browser

### If server stops:

Restart it with:
```bash
python -m http.server 8000
```

### If port 8000 is busy:

Use a different port:
```bash
python -m http.server 8001
```
Then use: `http://localhost:8001/examples/gpu-performance-demo.html`

## 📊 What to Expect

All tests should **PASS** on a properly functioning system with WebGPU support.

Expected output:
- ✅ Profiler display working
- ✅ Field mapping correct
- ✅ Scene graph stable (no crashes/stalls)

## 📝 Save Results

After running tests, copy the results from the console or page and save them to update the performance report.

---

**Server Status:** ✅ Running on http://localhost:8000

**Ready to test!** Open the URL above in your browser.

