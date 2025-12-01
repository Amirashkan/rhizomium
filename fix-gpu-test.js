/**
 * Fix GPU Performance Test Initialization
 * 
 * Run this in the browser console after the app loads to ensure GPUPerformanceTest is available
 */

(async function fixGPUTest() {
  console.log('🔧 Checking GPU Performance Test initialization...');
  
  // Check if device exists
  if (!window.gpuRenderer?.device) {
    console.error('❌ GPU device not found. Waiting for initialization...');
    
    // Wait up to 10 seconds for device
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (window.gpuRenderer?.device) {
        console.log('✅ GPU device found!');
        break;
      }
    }
    
    if (!window.gpuRenderer?.device) {
      console.error('❌ GPU device still not available after waiting.');
      console.log('Try refreshing the page or check browser console for errors.');
      return;
    }
  }
  
  // Check if GPUPerformanceMonitor exists
  if (!window.gpuPerformanceMonitor) {
    console.log('⚠️ GPUPerformanceMonitor not found. Initializing...');
    try {
      const { GPUPerformanceMonitor } = await import('./src/utils/GPUPerformanceMonitor.js');
      window.gpuPerformanceMonitor = new GPUPerformanceMonitor({
        autoShowOverlay: false,
        enableWarnings: true
      });
      window.gpuPerformanceMonitor.initialize(window.gpuRenderer.device);
      console.log('✅ GPUPerformanceMonitor initialized');
    } catch (e) {
      console.error('❌ Failed to initialize GPUPerformanceMonitor:', e);
      return;
    }
  }
  
  // Check if GPUPerformanceTest exists
  if (!window.gpuPerformanceTest) {
    console.log('⚠️ GPUPerformanceTest not found. Initializing...');
    try {
      const { GPUPerformanceTest } = await import('./src/test/GPUPerformanceTest.js');
      window.gpuPerformanceTest = new GPUPerformanceTest(window.gpuRenderer.device);
      console.log('✅ GPUPerformanceTest initialized!');
    } catch (e) {
      console.error('❌ Failed to initialize GPUPerformanceTest:', e);
      return;
    }
  } else {
    console.log('✅ GPUPerformanceTest already exists');
  }
  
  // Verify it works
  if (window.gpuPerformanceTest) {
    console.log('✅ GPU Performance Test is ready!');
    console.log('Run: await window.gpuPerformanceTest.runAllTests()');
  }
})();

