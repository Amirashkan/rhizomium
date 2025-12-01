# Quick Start: GPU Performance Tests

## 🚀 Fastest Way to Run GPU Tests

If you're having issues with Flask installation, you can run GPU tests using Python's built-in HTTP server:

### Step 1: Start Simple HTTP Server

```bash
# In the project directory
python -m http.server 8000
```

### Step 2: Open in Browser

Open one of these URLs:

**If deployed on Vercel:**
- **Main Application (Recommended):** `https://your-project.vercel.app/studio`
- **GPU Demo Page:** `https://your-project.vercel.app/examples/gpu-performance-demo.html`

**If using local HTTP server:**
- **Main Application:** `http://localhost:8000/editor/index.html`
- **GPU Demo Page:** `http://localhost:8000/examples/gpu-performance-demo.html`

### Step 3: Run Tests

**Option A: Using the Demo Page**
1. Open `http://localhost:8000/examples/gpu-performance-demo.html`
2. Click "Run All Tests" button
3. View results on the page

**Option B: Using Browser Console**
1. Open `http://localhost:8000/studio` (or the demo page)
2. Press F12 to open developer console
3. Run:
   ```javascript
   // Run all GPU tests
   await window.gpuPerformanceTest?.runAllTests();
   
   // Or individual tests
   window.gpuPerformanceTest?.testProfilerDisplay();
   window.gpuPerformanceTest?.testFieldToWorldMapping();
   await window.gpuPerformanceTest?.testSceneGraphUpdates();
   ```

## 📊 What Gets Tested

1. **Profiler Display** - Verifies profiler overlay works
2. **Field Mapping** - Tests field data to 3D position mapping
3. **Scene Graph Stability** - Tests GPU stability during updates
   - Command buffer synchronization
   - Memory leak detection
   - Command buffer stall detection
   - Error recovery

## ✅ Expected Results

All tests should pass on a properly functioning system with WebGPU support.

## 🔧 Troubleshooting

### WebGPU Not Available

**Check WebGPU Support:**
```javascript
// In browser console
console.log('WebGPU available:', navigator.gpu !== undefined);
```

**Enable WebGPU (Chrome/Edge):**
1. Go to: `chrome://flags/#enable-unsafe-webgpu`
2. Enable "Unsafe WebGPU"
3. Restart browser

### Tests Not Running

**Check if objects exist:**
```javascript
// In browser console
console.log('GPU Test:', window.gpuPerformanceTest);
console.log('Profiler:', window.computeProfiler);
console.log('Monitor:', window.gpuPerformanceMonitor);
```

**If undefined:**
- Make sure you're on the main application page, not just a demo
- Check browser console for errors
- Try refreshing the page

### Server Issues

**Port Already in Use:**
```bash
# Use different port
python -m http.server 8001
```

**Permission Denied:**
- Try a different port (8000, 8080, 3000, etc.)
- Check firewall settings

## 📝 Next Steps

After running GPU tests:
1. Copy results from console
2. Save to a file (e.g., `gpu-test-results.json`)
3. Update `PERFORMANCE_TEST_REPORT.md` with results
4. Run performance benchmarks (see `PERFORMANCE_TEST_STEPS.md`)

---

**Note:** Simple HTTP server doesn't support Flask-specific features (external viewer, API endpoints), but GPU performance tests work perfectly!

