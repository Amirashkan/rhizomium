# Automated Testing & Guardrails - Acceptance Checklist

This document outlines the acceptance criteria for the automated testing and guardrails implementation.

## Test Coverage

### Unit Tests

- [x] **PreviewThrottler Tests** (`tests/PreviewThrottler.test.js`)
  - [x] Basic throttling behavior
  - [x] Mode management (idle, edit, drag, compile)
  - [x] Interaction state management
  - [x] Update mode logic
  - [x] Disposal and cleanup

- [x] **RenderCache Tests** (`tests/RenderCache.test.js`)
  - [x] Basic caching (hit/miss)
  - [x] LRU eviction
  - [x] Node invalidation
  - [x] Key invalidation
  - [x] Lifetime management
  - [x] Framebuffer caching
  - [x] Metrics tracking

- [x] **InvalidationManager Tests** (`tests/InvalidationManager.test.js`)
  - [x] Already exists and covers:
    - Basic invalidation
    - Region merging
    - Connection invalidation
    - Edge cases

- [x] **PreviewPerfMonitor Tests** (`tests/PreviewPerfMonitor.test.js`)
  - [x] Alert system for redraw spikes
  - [x] Alert configuration
  - [x] Alert statistics
  - [x] Frame time history tracking

- [x] **PerformanceBenchmark Tests** (`tests/PerformanceBenchmark.test.js`)
  - [x] Throttled scenario factories
  - [x] Scenario execution
  - [x] Results comparison

### Integration Tests

- [x] **Throttling Integration** (`tests/ThrottlingIntegration.test.js`)
  - [x] Interaction state integration
  - [x] Mode priority handling
  - [x] Real-world scenarios
  - [x] Performance characteristics

## Performance Benchmark Scenarios

### Throttled Path Scenarios

- [x] **Parameter Dragging** (`parameterDragging`)
  - Simulates rapid parameter updates during dragging
  - Tests throttling at 20fps (50ms interval)

- [x] **Canvas Panning** (`canvasPanning`)
  - Simulates canvas interaction throttling
  - Tests performance during panning operations

- [x] **Shader Compilation** (`shaderCompilation`)
  - Simulates throttling during shader compilation
  - Tests 2fps throttling (500ms interval)

- [x] **Rapid Graph Changes** (`rapidGraphChanges`)
  - Tests invalidation system under rapid changes
  - Validates cache invalidation performance

- [x] **Cache Thrashing** (`cacheThrashing`)
  - Tests cache performance under memory pressure
  - Validates LRU eviction behavior

- [x] **Mixed Interactions** (`mixedInteractions`)
  - Tests complex throttling with multiple simultaneous interactions
  - Validates mode priority and state management

## Alert System

### PreviewPerfMonitor Alerts

- [x] **Redraw Spike Detection**
  - Configurable threshold (default: 50ms)
  - Configurable window size (default: 5 frames)
  - Configurable consecutive spike threshold (default: 3)

- [x] **Alert Management**
  - Alert cooldown to prevent spam (default: 5s)
  - Alert history tracking (max 100 alerts)
  - Alert statistics and reporting

- [x] **Alert Callbacks**
  - Custom alert callback support
  - Event emission for external listeners
  - Console warnings for debugging

## CI Integration

### GitHub Actions Workflow

- [x] **Unit Tests Job**
  - Runs on Node.js 18.x and 20.x
  - Generates coverage reports
  - Uploads to Codecov

- [x] **Integration Tests Job**
  - Runs throttling integration tests
  - Runs invalidation tests
  - Runs cache tests

- [x] **Performance Tests Job**
  - Runs performance benchmark tests
  - Runs performance monitor tests
  - Stores benchmark results as artifacts

- [x] **Test Summary Job**
  - Aggregates test results
  - Provides summary in GitHub Actions

## Test Execution

### Running Tests Locally

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- tests/PreviewThrottler.test.js
npm test -- tests/RenderCache.test.js
npm test -- tests/ThrottlingIntegration.test.js

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run with UI
npm run test:ui
```

### Running Performance Benchmarks

```javascript
// In browser console
const benchmark = window.performanceBenchmark;
const results = await benchmark.runThrottledScenarios();
console.log(results);
```

## Performance Metrics

### Target Metrics

| Metric | Target | Warning Threshold |
|--------|--------|-------------------|
| Frame Time (Idle) | <16.67ms | >33.33ms |
| Frame Time (Drag) | <50ms | >100ms |
| Frame Time (Compile) | <500ms | >1000ms |
| Cache Hit Rate | >80% | <60% |
| Redraw Spikes | 0 per minute | >3 per minute |

### Alert Thresholds

- **Redraw Spike**: Frame time > 50ms
- **Consecutive Spikes**: 3+ consecutive spikes
- **Alert Cooldown**: 5 seconds minimum between alerts

## Acceptance Criteria

### Code Quality

- [x] All tests pass in CI
- [x] Code coverage > 80% for new code
- [x] No linter errors
- [x] All tests are deterministic (no flaky tests)

### Functionality

- [x] Throttling works correctly in all modes
- [x] Cache invalidation works correctly
- [x] Alert system detects performance spikes
- [x] Benchmark scenarios execute successfully

### Documentation

- [x] Test files are well-documented
- [x] CI workflow is documented
- [x] Acceptance checklist is complete
- [x] Performance metrics are documented

### CI/CD

- [x] Tests run automatically on push/PR
- [x] Performance tests run daily
- [x] Coverage reports are generated
- [x] Test results are visible in GitHub Actions

## Known Limitations

### GPU Acceleration in CI

- **Issue**: CI environments typically lack GPU acceleration
- **Solution**: Tests use WebGPU mocks for deterministic testing
- **Note**: Real GPU performance tests should be run manually on hardware

### Flaky Performance Tests

- **Risk**: Performance tests may be flaky due to timing variations
- **Mitigation**: 
  - Use statistical analysis (percentiles) instead of exact values
  - Allow reasonable variance in timing measurements
  - Use warmup frames to stabilize measurements

### Test Execution Time

- **Current**: ~30-60 seconds for full test suite
- **Target**: <2 minutes for CI pipeline
- **Optimization**: Tests run in parallel where possible

## Future Improvements

- [ ] Add visual regression tests
- [ ] Add end-to-end tests with Playwright
- [ ] Add performance regression detection
- [ ] Add automated performance reports
- [ ] Add GPU hardware testing in dedicated runners
- [ ] Add memory leak detection tests
- [ ] Add stress tests for large graphs

## Sign-off

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] All performance tests passing
- [ ] CI pipeline green
- [ ] Code review approved
- [ ] Documentation complete

---

**Last Updated**: 2024-01-XX
**Status**: Implementation Complete

