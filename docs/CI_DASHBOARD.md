# CI Dashboard Configuration

This document describes the CI dashboard setup for monitoring test results and performance metrics.

## GitHub Actions Dashboard

### Test Status Badges

Add these badges to your README.md:

```markdown
![Unit Tests](https://github.com/your-org/glsl-node-editor/workflows/unit-tests/badge.svg)
![Integration Tests](https://github.com/your-org/glsl-node-editor/workflows/integration-tests/badge.svg)
![Performance Tests](https://github.com/your-org/glsl-node-editor/workflows/performance-tests/badge.svg)
![Coverage](https://codecov.io/gh/your-org/glsl-node-editor/branch/main/graph/badge.svg)
```

### Workflow Status

View workflow runs at:
- `https://github.com/your-org/glsl-node-editor/actions`

### Test Results

Test results are available in:
- GitHub Actions summary
- Codecov coverage reports
- Artifact downloads (benchmark results)

## Codecov Integration

### Setup

1. Sign up at [codecov.io](https://codecov.io)
2. Add repository
3. Get upload token
4. Add token to GitHub Secrets as `CODECOV_TOKEN`

### Coverage Reports

Coverage reports are automatically generated and uploaded:
- **Location**: `coverage/coverage-final.json`
- **Format**: JSON, HTML, text
- **Threshold**: 80% minimum coverage

### Coverage Dashboard

View coverage at:
- `https://codecov.io/gh/your-org/glsl-node-editor`

## Performance Metrics Dashboard

### Benchmark Results

Benchmark results are stored as GitHub Actions artifacts:
- **Location**: `benchmark-results/`
- **Format**: JSON
- **Retention**: 90 days

### Metrics Tracked

1. **Frame Time Distribution**
   - P50, P75, P90, P95, P99
   - Average, min, max

2. **FPS Metrics**
   - Average FPS
   - Min/Max FPS
   - FPS stability

3. **System Times**
   - Canvas rendering time
   - GPU preview time
   - Other processing time

4. **Throttling Metrics**
   - Throttling events count
   - Skipped frames
   - Budget exceeded count

5. **Cache Metrics**
   - Hit rate
   - Miss rate
   - Evictions
   - Memory usage

### Alert Metrics

- Redraw spike count
- Average spike frame time
- Max spike frame time
- Alerts by interaction state

## Custom Dashboard (Optional)

### Using GitHub Pages

Create a dashboard page that displays:
- Test results summary
- Performance trends
- Coverage trends
- Alert history

### Example Dashboard Structure

```html
<!DOCTYPE html>
<html>
<head>
  <title>GLSL Node Editor - CI Dashboard</title>
</head>
<body>
  <h1>CI Dashboard</h1>
  
  <section id="test-results">
    <h2>Test Results</h2>
    <!-- Test status widgets -->
  </section>
  
  <section id="performance">
    <h2>Performance Metrics</h2>
    <!-- Performance charts -->
  </section>
  
  <section id="coverage">
    <h2>Code Coverage</h2>
    <!-- Coverage charts -->
  </section>
  
  <section id="alerts">
    <h2>Performance Alerts</h2>
    <!-- Alert history -->
  </section>
</body>
</html>
```

## Monitoring

### Daily Performance Tests

Performance tests run daily at 2 AM UTC via scheduled workflow:
- Tracks performance trends over time
- Detects performance regressions
- Generates performance reports

### Alert Notifications

Configure alerts for:
- Test failures
- Performance regressions
- Coverage drops
- Build failures

### Slack/Discord Integration

Add webhook notifications:
```yaml
- name: Notify on failure
  if: failure()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

## Metrics Collection

### Test Metrics

- Test execution time
- Test pass/fail rate
- Test flakiness rate
- Coverage percentage

### Performance Metrics

- Frame time percentiles
- FPS averages
- System time breakdowns
- Throttling effectiveness

### Build Metrics

- Build time
- Build success rate
- Artifact sizes
- Dependency update frequency

## Reporting

### Weekly Reports

Generate weekly reports with:
- Test summary
- Performance trends
- Coverage changes
- Alert summary

### Monthly Reports

Generate monthly reports with:
- Performance regression analysis
- Test coverage trends
- Build reliability metrics
- Improvement recommendations

## Access Control

### Public Repositories

- All test results are public
- Coverage reports are public
- Performance metrics are public

### Private Repositories

- Test results require authentication
- Coverage reports require authentication
- Performance metrics require authentication

## Troubleshooting

### Failed Tests

1. Check GitHub Actions logs
2. Review test output
3. Check for flaky tests
4. Review recent changes

### Performance Regressions

1. Compare benchmark results
2. Review code changes
3. Check for throttling issues
4. Review cache performance

### Coverage Drops

1. Review coverage report
2. Check for untested code paths
3. Review test changes
4. Add missing tests

---

**Last Updated**: 2024-01-XX
**Status**: Configuration Complete

