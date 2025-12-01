# Performance Test Steps - Quick Reference

## ✅ Completed Steps

### 1. Unit Tests (Automated)
- ✅ Run: `npm test`
- ✅ Results: 131/150 tests passed (87.33%)
- ✅ Report: See `PERFORMANCE_TEST_REPORT.md`

## 📋 Next Steps (Your Action Required)

### Step 1: Review Unit Test Failures

**Critical Issues to Fix:**
1. **InteractionStateManager** - Missing methods:
   - Add `reset()` method
   - Add `setEditing()` method
   - Location: `src/utils/InteractionStateManager.js`

2. **Preview Throttler** - Throttling logic issues
   - Review interval calculations
   - Fix mode switching behavior
   - Location: `src/utils/PreviewThrottler.js`

3. **Render Cache** - Caching issues
   - Fix invalidation counter
   - Fix expiration cleanup
   - Enforce memory limits
   - Location: `src/utils/RenderCache.js`

### Step 2: Run GPU Performance Tests (Browser Required)

**Prerequisites:**
- Modern browser with WebGPU support (Chrome 113+, Edge 113+)
- Python 3.8+ installed
- Development server running

**Steps:**

1. **Start the server (choose one method):**

   **Option A: Flask Server (Full Features)**
   ```bash
   # Windows
   START_SERVER.bat
   
   # Or manually
   python rhizo_server.py
   ```
   Then open: `http://127.0.0.1:5000/studio`

   **Option B: Simple HTTP Server (GPU Tests Only)**
   ```bash
   # Python 3
   python -m http.server 8000
   ```
   Then open: `http://localhost:8000/studio` or `http://localhost:8000/examples/gpu-performance-demo.html`

2. **Open the application:**
   - Flask server: `http://127.0.0.1:5000/studio`
   - Simple server: `http://localhost:8000/studio`
   - Or open: `examples/gpu-performance-demo.html` directly (file:// protocol)

3. **Run GPU tests in browser console (F12):**
   ```javascript
   // Option 1: Run all tests
   await window.gpuPerformanceTest?.runAllTests();
   
   // Option 2: Use monitor wrapper
   await window.gpuPerformanceMonitor?.runTests();
   
   // Option 3: Run individual tests
   window.gpuPerformanceTest?.testProfilerDisplay();
   window.gpuPerformanceTest?.testFieldToWorldMapping();
   await window.gpuPerformanceTest?.testSceneGraphUpdates();
   ```

4. **Or use the interactive demo page:**
   - Open: `examples/gpu-performance-demo.html`
   - Click "Run All Tests" button
   - View results on the page

### Step 3: Run Performance Benchmarks

**In browser console after loading the application:**

```javascript
// Get benchmark instance
const benchmark = window.performanceBenchmark;

// Get available scenarios
const scenarios = PerformanceBenchmark.getThrottledScenarios();
console.log('Available scenarios:', Object.keys(scenarios));

// Run all throttled scenarios
const results = await benchmark.runThrottledScenarios({
  warmupFrames: 60,
  measurementFrames: 300,  // 5 seconds at 60fps
  cooldownFrames: 30
});

// View results
console.log('Benchmark Results:', results);

// Export results
const jsonResults = benchmark.exportResults();
console.log('JSON Results:', jsonResults);

// Save to file (copy from console)
// Then save as: benchmark-results.json
```

### Step 4: Monitor Real-time Performance

**Using Profiler Overlay:**

1. **Toggle overlay:**
   - Press `Ctrl+P` (or `Cmd+P` on Mac)
   - Or in console: `window.profilerOverlay?.toggle()`

2. **Monitor metrics:**
   - **FPS:** Should be 60 (green) - Target: ≥60 FPS
   - **Frame Time:** Should be <16.67ms (green) - Target: ≤16.67ms
   - **Compute Time:** Should be <5ms (green) - Target: ≤5ms
   - **Dispatches:** Number of compute shader dispatches per frame
   - **Workgroups:** Total workgroups processed

3. **Check for warnings:**
   - Red indicators = Performance issues
   - Yellow indicators = Warning thresholds
   - Green indicators = Good performance

4. **Keyboard shortcuts:**
   - `Ctrl+P` - Toggle profiler overlay
   - `Ctrl+Shift+P` - Run performance tests
   - `Ctrl+Shift+R` - Reset profiler metrics
   - `Ctrl+Shift+E` - Toggle profiler enabled/disabled
   - `+` - Expand dispatch details (in overlay)
   - `-` - Collapse dispatch details (in overlay)

### Step 5: Performance Analysis

**After running tests, analyze:**

1. **Frame Rate:**
   - Target: 60 FPS consistently
   - Warning: <30 FPS
   - Check frame time distribution (p95, p99)

2. **System Times:**
   - Canvas rendering time
   - GPU compute time
   - Other overhead

3. **Budget Exceeded:**
   - Count of frames exceeding 16.67ms budget
   - Should be 0 for optimal performance

4. **Throttling Events:**
   - Number of throttled updates
   - Should be appropriate for interaction state

## 📊 Expected Results

### GPU Performance Targets

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| **FPS** | 60 | 30-60 | <30 |
| **Frame Time** | <16.67ms | 16.67-33.33ms | >33.33ms |
| **Compute Time** | <5ms | 5-10ms | >10ms |
| **Budget Exceeded** | 0 | <5% | >5% |

### Test Results Summary

- **Unit Tests:** 131/150 passed (87.33%)
- **GPU Tests:** Pending (requires browser)
- **Benchmarks:** Pending (requires browser)

## 🔧 Troubleshooting

### GPU Tests Not Running

**Issue:** `window.gpuPerformanceTest` is undefined

**Solution:**
1. Ensure the main application is loaded (not just the demo page)
2. Check browser console for errors
3. Verify WebGPU is supported: `navigator.gpu !== undefined`
4. Try loading: `http://127.0.0.1:5000/studio`

### Server Not Starting

**Issue:** Python server fails to start

**Solution:**
1. Check Python version: `python --version` (need 3.8+)
2. Install dependencies: `pip install -r requirements.txt`
3. Check if port 5000 is available
4. Try different port: `python rhizo_server.py --port 5001`

**Issue:** `ModuleNotFoundError: No module named 'flask'`

**Solution:**
1. Install Flask: `pip install flask flask-cors`
2. If pip has network/SSL issues, try:
   - `pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org flask flask-cors`
   - Or use a different network/VPN
   - Or install from offline wheel files

**Alternative: Use Simple HTTP Server (for GPU tests only)**

If Flask installation fails, you can use Python's built-in HTTP server for GPU tests:

```bash
# Python 3
python -m http.server 8000

# Then open in browser:
# http://localhost:8000/studio
# or
# http://localhost:8000/examples/gpu-performance-demo.html
```

**Note:** Simple HTTP server won't support external viewer features, but GPU performance tests will work.

### WebGPU Not Available

**Issue:** Browser doesn't support WebGPU

**Solution:**
1. Use Chrome 113+ or Edge 113+
2. Enable WebGPU flag: `chrome://flags/#enable-unsafe-webgpu`
3. Check: `chrome://gpu` for WebGPU status

## 📝 Reporting Results

After completing all steps:

1. **Save GPU test results:**
   ```javascript
   const gpuResults = await window.gpuPerformanceTest?.runAllTests();
   console.log(JSON.stringify(gpuResults, null, 2));
   // Copy and save as: gpu-test-results.json
   ```

2. **Save benchmark results:**
   ```javascript
   const benchmark = window.performanceBenchmark;
   const results = await benchmark.runThrottledScenarios();
   console.log(benchmark.exportResults());
   // Copy and save as: benchmark-results.json
   ```

3. **Update report:**
   - Add GPU test results to `PERFORMANCE_TEST_REPORT.md`
   - Add benchmark results to report
   - Document any issues or anomalies

## ✅ Checklist

- [ ] Unit tests reviewed (see `PERFORMANCE_TEST_REPORT.md`)
- [ ] Server started successfully
- [ ] Application loaded in browser
- [ ] GPU tests run successfully
- [ ] Benchmark scenarios executed
- [ ] Real-time performance monitored
- [ ] Results documented
- [ ] Issues identified and prioritized

---

**Need Help?**
- See `PERFORMANCE_TEST_REPORT.md` for detailed analysis
- Check `GPU_PERFORMANCE_GUIDE.md` for GPU testing guide
- Review test files in `tests/` directory

