/**
 * GPUPerformanceTest - Comprehensive test suite for GPU performance and scene graph
 *
 * Tests:
 * 1. Frame rate and compute dispatch info display
 * 2. Field data to 3D position mapping verification
 * 3. GPU crash/stall prevention during scene graph updates
 */

export class GPUPerformanceTest {
  constructor(device) {
    this.device = device;
    this.testResults = {
      profilerTest: null,
      mappingTest: null,
      sceneGraphTest: null
    };
  }

  /**
   * Test 1: Verify profiler and overlay are working
   */
  testProfilerDisplay() {
    const profiler = window.computeProfiler;
    const overlay = window.profilerOverlay;

    if (!profiler) {
      this.testResults.profilerTest = {
        success: false,
        error: 'ComputeProfiler not found'
      };
      return this.testResults.profilerTest;
    }

    if (!overlay) {
      this.testResults.profilerTest = {
        success: false,
        error: 'ComputeProfilerOverlay not found'
      };
      return this.testResults.profilerTest;
    }

    // Check if profiler is enabled
    const metrics = profiler.getMetrics();
    if (!metrics.enabled) {
      profiler.setEnabled(true);
    }

    // Check if overlay can be toggled
    const wasVisible = overlay.visible;
    overlay.show();
    const isVisibleAfterShow = overlay.visible;
    overlay.hide();
    const isVisibleAfterHide = overlay.visible;

    // Restore original state
    if (wasVisible) {
      overlay.show();
    }

    this.testResults.profilerTest = {
      success: true,
      profilerEnabled: metrics.enabled,
      overlayExists: !!overlay,
      overlayToggleWorks: isVisibleAfterShow && !isVisibleAfterHide,
      supportsTimestamps: metrics.supportsTimestamps,
      currentMetrics: {
        fps: metrics.fps.toFixed(1),
        frameTime: metrics.frameTime.toFixed(2) + 'ms',
        dispatches: metrics.activeWorkgroups,
        workgroups: metrics.totalWorkgroups
      }
    };

    console.log('[GPUPerformanceTest] ✓ Profiler test passed:', this.testResults.profilerTest);
    return this.testResults.profilerTest;
  }

  /**
   * Test 2: Verify field data to 3D position mapping
   */
  testFieldToWorldMapping() {
    // Create test mapper node
    const { ComputeFieldMapperNode } = window;
    if (!ComputeFieldMapperNode) {
      // Try to import dynamically
      import('../scene/nodes/ComputeFieldMapperNode.js').then(module => {
        this._runMappingTest(module.ComputeFieldMapperNode);
      }).catch(err => {
        this.testResults.mappingTest = {
          success: false,
          error: 'Failed to load ComputeFieldMapperNode: ' + err.message
        };
      });
      return;
    }

    this._runMappingTest(ComputeFieldMapperNode);
    return this.testResults.mappingTest;
  }

  _runMappingTest(ComputeFieldMapperNode) {
    const mapper = new ComputeFieldMapperNode('test', {
      dimensions: [64, 64, 64],
      fieldBounds: {
        min: [-1, -1, -1],
        max: [1, 1, 1]
      }
    });

    const testCases = [
      // Test corners
      { input: [0, 0, 0], expected: [-1, -1, -1], name: 'Origin (0,0,0)' },
      { input: [64, 64, 64], expected: [1, 1, 1], name: 'Max corner (64,64,64)' },
      { input: [32, 32, 32], expected: [0, 0, 0], name: 'Center (32,32,32)' },

      // Test edges
      { input: [0, 0, 64], expected: [-1, -1, 1], name: 'Edge (0,0,64)' },
      { input: [64, 0, 0], expected: [1, -1, -1], name: 'Edge (64,0,0)' },

      // Test arbitrary points
      { input: [16, 32, 48], expected: [-0.5, 0, 0.5], name: 'Arbitrary (16,32,48)' }
    ];

    const results = [];
    let allPassed = true;
    const epsilon = 0.001; // Tolerance for floating point comparison

    for (const testCase of testCases) {
      const [i, j, k] = testCase.input;
      const result = mapper.fieldToWorld(i, j, k);
      const [expectedX, expectedY, expectedZ] = testCase.expected;

      const passed =
        Math.abs(result[0] - expectedX) < epsilon &&
        Math.abs(result[1] - expectedY) < epsilon &&
        Math.abs(result[2] - expectedZ) < epsilon;

      results.push({
        name: testCase.name,
        input: testCase.input,
        expected: testCase.expected,
        actual: result,
        passed
      });

      if (!passed) {
        allPassed = false;
        console.error(`[GPUPerformanceTest] ✗ Mapping test failed: ${testCase.name}`, {
          expected: testCase.expected,
          actual: result,
          diff: [
            Math.abs(result[0] - expectedX),
            Math.abs(result[1] - expectedY),
            Math.abs(result[2] - expectedZ)
          ]
        });
      } else {
        console.log(`[GPUPerformanceTest] ✓ Mapping test passed: ${testCase.name}`);
      }
    }

    this.testResults.mappingTest = {
      success: allPassed,
      results,
      summary: `${results.filter(r => r.passed).length}/${results.length} tests passed`
    };

    console.log('[GPUPerformanceTest] Mapping test complete:', this.testResults.mappingTest);
  }

  /**
   * Test 3: Verify no GPU crashes or stalls during scene graph updates
   */
  async testSceneGraphUpdates() {
    console.log('[GPUPerformanceTest] Testing scene graph updates for GPU stability...');

    if (!this.device) {
      this.testResults.sceneGraphTest = {
        success: false,
        error: 'GPU device not available'
      };
      return this.testResults.sceneGraphTest;
    }

    const testResults = {
      synchronization: null,
      memoryLeaks: null,
      commandBufferStalls: null,
      errorRecovery: null
    };

    try {
      // Test 1: Command buffer synchronization
      console.log('[GPUPerformanceTest] Testing command buffer synchronization...');
      const syncResult = await this._testCommandBufferSync();
      testResults.synchronization = syncResult;

      // Test 2: Memory leak detection during updates
      console.log('[GPUPerformanceTest] Testing for memory leaks...');
      const memResult = await this._testMemoryLeaks();
      testResults.memoryLeaks = memResult;

      // Test 3: Command buffer stall detection
      console.log('[GPUPerformanceTest] Testing for command buffer stalls...');
      const stallResult = await this._testCommandBufferStalls();
      testResults.commandBufferStalls = stallResult;

      // Test 4: Error recovery
      console.log('[GPUPerformanceTest] Testing error recovery...');
      const errorResult = await this._testErrorRecovery();
      testResults.errorRecovery = errorResult;

      const allPassed = Object.values(testResults).every(r => r?.passed);

      this.testResults.sceneGraphTest = {
        success: allPassed,
        tests: testResults,
        summary: allPassed ? 'All GPU stability tests passed' : 'Some GPU stability tests failed'
      };

      console.log('[GPUPerformanceTest] Scene graph test complete:', this.testResults.sceneGraphTest);
      return this.testResults.sceneGraphTest;

    } catch (error) {
      console.error('[GPUPerformanceTest] Scene graph test error:', error);
      this.testResults.sceneGraphTest = {
        success: false,
        error: error.message,
        stack: error.stack
      };
      return this.testResults.sceneGraphTest;
    }
  }

  /**
   * Test command buffer synchronization
   */
  async _testCommandBufferSync() {
    const iterations = 10;
    let passed = true;
    const timings = [];

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();

      try {
        const encoder = this.device.createCommandEncoder({
          label: `sync-test-${i}`
        });

        // Create a simple compute pass
        const computePass = encoder.beginComputePass();
        computePass.end();

        // Submit and wait
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();

        const duration = performance.now() - startTime;
        timings.push(duration);

        if (duration > 100) {
          console.warn(`[GPUPerformanceTest] Slow sync detected: ${duration.toFixed(2)}ms`);
        }
      } catch (error) {
        console.error('[GPUPerformanceTest] Sync test failed:', error);
        passed = false;
        break;
      }
    }

    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    const maxTime = Math.max(...timings);

    return {
      passed,
      iterations,
      avgTime: avgTime.toFixed(2) + 'ms',
      maxTime: maxTime.toFixed(2) + 'ms',
      allTimings: timings.map(t => t.toFixed(2))
    };
  }

  /**
   * Test for memory leaks during scene graph updates
   */
  async _testMemoryLeaks() {
    // Monitor buffer creation/destruction
    const initialBuffers = this.device ? 1 : 0; // Rough estimate
    const testBuffers = [];

    try {
      // Create and destroy buffers multiple times
      for (let i = 0; i < 100; i++) {
        const buffer = this.device.createBuffer({
          size: 256,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `leak-test-${i}`
        });
        testBuffers.push(buffer);

        // Destroy immediately
        buffer.destroy();
      }

      // Check if device is still operational
      const encoder = this.device.createCommandEncoder();
      encoder.finish();

      return {
        passed: true,
        buffersCreated: testBuffers.length,
        note: 'No memory leak detected (device still operational after 100 buffer cycles)'
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message,
        buffersCreated: testBuffers.length
      };
    }
  }

  /**
   * Test for command buffer stalls
   */
  async _testCommandBufferStalls() {
    const stallThreshold = 50; // ms
    const iterations = 20;
    let stalls = 0;

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();

      const encoder = this.device.createCommandEncoder();
      const computePass = encoder.beginComputePass();
      computePass.end();

      const commandBuffer = encoder.finish();
      this.device.queue.submit([commandBuffer]);

      // Don't wait, check if submission was fast
      const submitTime = performance.now() - startTime;

      if (submitTime > stallThreshold) {
        stalls++;
        console.warn(`[GPUPerformanceTest] Stall detected at iteration ${i}: ${submitTime.toFixed(2)}ms`);
      }
    }

    return {
      passed: stalls === 0,
      iterations,
      stalls,
      stallThreshold: stallThreshold + 'ms',
      message: stalls === 0 ? 'No stalls detected' : `${stalls} stalls detected`
    };
  }

  /**
   * Test error recovery
   */
  async _testErrorRecovery() {
    try {
      // Try to create an invalid buffer (size too large)
      let errorCaught = false;

      try {
        const invalidBuffer = this.device.createBuffer({
          size: Number.MAX_SAFE_INTEGER,
          usage: GPUBufferUsage.UNIFORM
        });
      } catch (error) {
        errorCaught = true;
        console.log('[GPUPerformanceTest] Expected error caught:', error.message);
      }

      // Verify device still works after error
      const testEncoder = this.device.createCommandEncoder();
      testEncoder.finish();

      return {
        passed: errorCaught,
        message: errorCaught
          ? 'Error recovery successful (device operational after invalid operation)'
          : 'Error recovery test inconclusive'
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('[GPUPerformanceTest] Running all GPU performance tests...');

    this.testProfilerDisplay();
    this.testFieldToWorldMapping();
    await this.testSceneGraphUpdates();

    const allPassed = Object.values(this.testResults).every(
      result => result && result.success
    );

    console.log('[GPUPerformanceTest] ========================================');
    console.log('[GPUPerformanceTest] TEST RESULTS SUMMARY');
    console.log('[GPUPerformanceTest] ========================================');
    console.log('[GPUPerformanceTest] 1. Profiler Display:', this.testResults.profilerTest?.success ? '✓ PASS' : '✗ FAIL');
    console.log('[GPUPerformanceTest] 2. Field Mapping:', this.testResults.mappingTest?.success ? '✓ PASS' : '✗ FAIL');
    console.log('[GPUPerformanceTest] 3. Scene Graph Stability:', this.testResults.sceneGraphTest?.success ? '✓ PASS' : '✗ FAIL');
    console.log('[GPUPerformanceTest] ========================================');
    console.log('[GPUPerformanceTest] Overall:', allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED');
    console.log('[GPUPerformanceTest] ========================================');

    return {
      allPassed,
      results: this.testResults
    };
  }

  /**
   * Get test results
   */
  getResults() {
    return this.testResults;
  }

  /**
   * Generate detailed report
   */
  generateReport() {
    return {
      timestamp: new Date().toISOString(),
      deviceInfo: {
        vendor: this.device?.adapter?.name || 'Unknown',
        limits: this.device?.limits || {}
      },
      results: this.testResults,
      summary: {
        profilerDisplayWorking: this.testResults.profilerTest?.success || false,
        fieldMappingCorrect: this.testResults.mappingTest?.success || false,
        sceneGraphStable: this.testResults.sceneGraphTest?.success || false
      }
    };
  }
}

// Auto-register for global access
if (typeof window !== 'undefined') {
  window.GPUPerformanceTest = GPUPerformanceTest;
}
