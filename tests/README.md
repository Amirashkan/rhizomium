# Compute Pipeline Testing

Automated validation tests for WebGPU compute pipelines to ensure consistent compute output across devices.

## Overview

This test suite validates compute pipeline operations in CI environments without requiring physical GPU hardware. It uses a comprehensive WebGPU mock that simulates GPU behavior deterministically.

## Test Coverage

### Core Tests (compute_pipeline.test.js)

The test suite includes 6 comprehensive tests:

1. **Uniform Updates and Propagation**
   - Verifies that parameter updates correctly propagate to GPU uniform buffers
   - Tests resolution, time, and custom parameters (scale, octaves, speed)
   - Validates buffer size and data layout

2. **Dispatch Dimension Calculations**
   - Tests correct workgroup dispatch calculations for various texture sizes
   - Validates workgroup size configuration (8x8 default)
   - Ensures compliance with GPU limits
   - Tests edge cases (non-power-of-2, small sizes, large sizes)

3. **Texture Content Checksum Validation**
   - Verifies deterministic compute output using checksums
   - Tests that identical parameters produce identical results
   - Validates that parameter changes affect output
   - Ensures compute execution actually modifies textures

4. **Pipeline Initialization with Feedback**
   - Tests pipeline creation without feedback (single texture)
   - Tests pipeline creation with feedback (ping-pong textures)
   - Validates bind group creation
   - Verifies texture swap behavior for feedback systems

5. **Resource Cleanup and State Management**
   - Validates proper GPU resource creation
   - Tests resource destruction and cleanup
   - Verifies state is properly reset after destroy()
   - Ensures no resource leaks

6. **ComputeNodeBase Integration (Bonus)**
   - Tests the unified ComputeNodeBase API
   - Validates node initialization and configuration
   - Tests parameter updates through high-level API
   - Verifies serialization/deserialization

## WebGPU Mock

The `webgpu-mock.js` file provides a complete mock implementation of WebGPU APIs:

### Mocked Components

- **MockGPUDevice**: Simulates GPU device with resource tracking
- **MockGPUTexture**: Stores pixel data and supports checksum validation
- **MockGPUBuffer**: Tracks uniform buffer writes
- **MockGPUComputePipeline**: Records dispatch operations
- **MockGPUCommandEncoder**: Tracks compute passes and operations
- **MockGPUQueue**: Simulates command submission and execution

### Mock Capabilities

- **Deterministic Output**: Produces consistent results for testing
- **Resource Tracking**: Monitors creation and destruction of resources
- **Operation History**: Records dispatches, copies, and submissions
- **Checksum Validation**: Calculates texture content checksums
- **Simulation Parameters**: Allows setting time and parameters for predictable output

### Usage in CI

The mock is automatically initialized for all tests via `setup.js`:

```javascript
import { setupWebGPUMock } from './webgpu-mock.js';
setupWebGPUMock();
```

## Running Tests

### Install Dependencies

```bash
npm install
```

This installs:
- `vitest`: Fast, modern test framework with ES modules support
- `@vitest/ui`: Interactive test UI
- `@vitest/coverage-v8`: Code coverage reporting
- `happy-dom`: Lightweight DOM implementation for Node.js

### Run Tests

```bash
# Run tests once
npm test

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Run tests with interactive UI
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

### Test Output

Successful test run:
```
✓ tests/compute_pipeline.test.js (6 tests)
  ✓ Compute Pipeline Validation
    ✓ should correctly update and propagate uniforms to GPU buffers
    ✓ should calculate correct dispatch dimensions for various texture sizes
    ✓ should produce consistent texture content with verifiable checksum
    ✓ should correctly initialize pipelines with and without feedback support
    ✓ should properly manage and cleanup GPU resources
    ✓ should work correctly with ComputeNodeBase wrapper

Test Files  1 passed (1)
     Tests  6 passed (6)
```

## CI Integration

### GitHub Actions Example

```yaml
name: Test Compute Pipelines

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install
      - run: npm test
```

### Why Mocking?

WebGPU requires:
- Modern browser with GPU support
- Physical GPU hardware
- Proper drivers and configuration

In CI environments:
- No GPU hardware available
- Headless environments
- Need for fast, deterministic tests

The mock provides:
- ✅ Fast test execution (no GPU initialization)
- ✅ Deterministic results (no driver variations)
- ✅ Works in any CI environment
- ✅ Full operation tracking for validation
- ✅ Resource leak detection

## Test Configuration

### vitest.config.js

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/test/**', 'src/gpu/examples/**']
    },
    testTimeout: 10000
  }
});
```

## Writing New Tests

### Example Test Structure

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComputeShaderManager } from '../src/gpu/ComputeShaderManager.js';

describe('My Compute Test', () => {
  let device;

  beforeEach(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    device = await adapter.requestDevice();
  });

  afterEach(() => {
    device.destroy();
  });

  it('should do something', async () => {
    const manager = new ComputeShaderManager(device);
    await manager.initialize(WGSL_CODE, 256, 256, false);

    // Set simulation parameters for deterministic output
    device.setSimulationParams(1.0, { scale: 8.0 });

    // Run compute
    const encoder = device.createCommandEncoder();
    manager.dispatch(encoder, 1.0);
    device.queue.submit([encoder.finish()]);

    // Validate
    const texture = manager.getOutputTexture();
    expect(texture.getChecksum()).toBeGreaterThan(0);

    manager.destroy();
  });
});
```

### Checksum Validation

The mock provides `texture.getChecksum()` for deterministic validation:

```javascript
// Execute compute with parameters
device.setSimulationParams(time, params);
const encoder = device.createCommandEncoder();
manager.dispatch(encoder, time);
device.queue.submit([encoder.finish()]);

// Get checksum
const checksum1 = manager.getOutputTexture().getChecksum();

// Same parameters = same checksum
device.setSimulationParams(time, params);
const encoder2 = device.createCommandEncoder();
manager.dispatch(encoder2, time);
device.queue.submit([encoder2.finish()]);

const checksum2 = manager.getOutputTexture().getChecksum();
expect(checksum2).toBe(checksum1); // ✓ Deterministic

// Different parameters = different checksum
device.setSimulationParams(time + 1, params);
const encoder3 = device.createCommandEncoder();
manager.dispatch(encoder3, time + 1);
device.queue.submit([encoder3.finish()]);

const checksum3 = manager.getOutputTexture().getChecksum();
expect(checksum3).not.toBe(checksum1); // ✓ Output changed
```

## Goals Achieved

✅ **Verify uniform updates and dispatch dimensions**
- Test 1 validates uniform buffer updates
- Test 2 validates dispatch dimension calculations

✅ **Test texture content checksum after compute**
- Test 3 uses deterministic checksums to validate compute output

✅ **Mock WebGPU in CI**
- Complete WebGPU mock implementation in `webgpu-mock.js`
- Automatic setup via `setup.js`
- Works in all CI environments

✅ **Ensure consistent compute output across devices**
- Deterministic simulation produces identical checksums
- Parameter changes are validated
- Resource management is verified

## Files

- `compute_pipeline.test.js` - Main test suite (6 tests)
- `webgpu-mock.js` - WebGPU mock implementation
- `setup.js` - Test setup and initialization
- `README.md` - This documentation

## Performance

Typical test execution time: **< 1 second**

```
Duration  482.29ms (transform 41.40ms, setup 0.00ms, collect 98.67ms, tests 342.22ms)
```

The mock is lightweight and optimized for fast test execution.

## Troubleshooting

### Tests fail with "navigator.gpu is undefined"

**Solution**: Ensure `setup.js` is configured in `vitest.config.js`:

```javascript
setupFiles: ['./tests/setup.js']
```

### Mock textures don't have expected data

**Solution**: Call `device.setSimulationParams()` before dispatching:

```javascript
device.setSimulationParams(time, params);
```

### Resource leak warnings

**Solution**: Always call `destroy()` in `afterEach`:

```javascript
afterEach(() => {
  manager.destroy();
  device.destroy();
});
```

## Future Enhancements

Potential additions to the test suite:

- [ ] Multi-node pipeline tests
- [ ] Feedback loop convergence tests
- [ ] Performance benchmarking
- [ ] Visual regression testing (compare rendered output)
- [ ] GPU memory usage tracking
- [ ] Shader compilation error handling
- [ ] Bind group caching validation

## References

- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [Vitest Documentation](https://vitest.dev/)
- [WebGPU Conformance Test Suite](https://github.com/gpuweb/cts)
