# Fix: GPUPerformanceTest Not Found

## Quick Fix - Run This in Browser Console

After the app loads at `/studio` (or `/editor/index.html`), open the browser console (F12) and run:

```javascript
// Copy and paste this entire script:
(async function() {
  if (!window.gpuRenderer?.device) {
    console.error('❌ GPU device not found. Please wait for app to load.');
    return;
  }
  
  if (!window.gpuPerformanceTest) {
    const { GPUPerformanceTest } = await import('./src/test/GPUPerformanceTest.js');
    window.gpuPerformanceTest = new GPUPerformanceTest(window.gpuRenderer.device);
    console.log('✅ GPUPerformanceTest initialized!');
  }
  
  // Now run tests
  await window.gpuPerformanceTest.runAllTests();
})();
```

## Or Use the Fix Script

1. Open the app: `https://your-project.vercel.app/studio` (or local equivalent)
2. Wait for it to fully load
3. Open browser console (F12)
4. Copy and paste the contents of `fix-gpu-test.js` into the console
5. Press Enter

## Why This Happens

The `GPUPerformanceTest` is created in `GPUPerformanceMonitor.initialize()` which is called from `main.js`. If there's any error during initialization, or if the device isn't ready, it won't be created.

## Permanent Fix

The issue is that `GPUPerformanceTest` initialization might fail silently. The fix script above manually creates it if it's missing.

## After Running the Fix

Once `window.gpuPerformanceTest` exists, you can run:

```javascript
// Run all tests
await window.gpuPerformanceTest.runAllTests();

// Or individual tests
window.gpuPerformanceTest.testProfilerDisplay();
window.gpuPerformanceTest.testFieldToWorldMapping();
await window.gpuPerformanceTest.testSceneGraphUpdates();
```

---

**The fix script is in:** `fix-gpu-test.js` - Copy its contents into browser console

