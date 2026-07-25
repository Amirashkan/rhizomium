/**
 * Performance Test Runner
 * 
 * This script runs all available performance tests and generates a comprehensive report.
 * 
 * Usage:
 *   node run-performance-tests.js
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PerformanceTestRunner {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      unitTests: null,
      gpuTests: {
        status: 'pending',
        note: 'GPU tests require browser environment - see instructions below'
      },
      summary: {}
    };
  }

  /**
   * Run unit tests using Vitest
   */
  runUnitTests() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Running Unit Tests (Vitest)...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
      const output = execSync('npm test', { 
        encoding: 'utf-8',
        cwd: __dirname,
        stdio: 'pipe'
      });

      // Parse test results
      const passedMatch = output.match(/(\d+) passed/);
      const failedMatch = output.match(/(\d+) failed/);

      const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
      const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
      const total = passed + failed;

      this.results.unitTests = {
        status: failed === 0 ? 'passed' : 'partial',
        passed,
        failed,
        total,
        passRate: total > 0 ? ((passed / total) * 100).toFixed(2) + '%' : '0%',
        output: output
      };

      console.log(`✓ Unit Tests Complete: ${passed}/${total} passed (${this.results.unitTests.passRate})`);
      if (failed > 0) {
        console.log(`  ⚠ ${failed} test(s) failed`);
      }
      console.log('');

      return this.results.unitTests;
    } catch (error) {
      const output = error.stdout?.toString() || error.message;
      
      // Try to parse even from error output
      const passedMatch = output.match(/(\d+) passed/);
      const failedMatch = output.match(/(\d+) failed/);
      
      const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
      const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
      const total = passed + failed;

      this.results.unitTests = {
        status: 'error',
        passed,
        failed,
        total,
        passRate: total > 0 ? ((passed / total) * 100).toFixed(2) + '%' : '0%',
        output: output,
        error: error.message
      };

      console.log(`✗ Unit Tests Error: ${error.message}`);
      console.log(`  Results: ${passed}/${total} passed\n`);
      
      return this.results.unitTests;
    }
  }

  /**
   * Generate comprehensive report
   */
  generateReport() {
    const report = {
      ...this.results,
      summary: this.generateSummary(),
      recommendations: this.generateRecommendations(),
      nextSteps: this.generateNextSteps()
    };

    // Save report to file
    const reportPath = join(__dirname, 'PERFORMANCE_TEST_REPORT.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Generate markdown report
    const markdownReport = this.generateMarkdownReport(report);
    const markdownPath = join(__dirname, 'PERFORMANCE_TEST_REPORT.md');
    writeFileSync(markdownPath, markdownReport);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Performance Test Report Generated');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`📄 JSON Report: ${reportPath}`);
    console.log(`📄 Markdown Report: ${markdownPath}\n`);

    return report;
  }

  generateSummary() {
    const summary = {
      overallStatus: 'unknown',
      unitTestsStatus: this.results.unitTests?.status || 'not_run',
      gpuTestsStatus: this.results.gpuTests?.status || 'pending',
      totalTests: this.results.unitTests?.total || 0,
      passedTests: this.results.unitTests?.passed || 0,
      failedTests: this.results.unitTests?.failed || 0,
      passRate: this.results.unitTests?.passRate || '0%'
    };

    // Determine overall status
    if (summary.unitTestsStatus === 'passed' && summary.failedTests === 0) {
      summary.overallStatus = 'good';
    } else if (summary.unitTestsStatus === 'partial' || summary.failedTests > 0) {
      summary.overallStatus = 'needs_attention';
    } else if (summary.unitTestsStatus === 'error') {
      summary.overallStatus = 'error';
    }

    return summary;
  }

  generateRecommendations() {
    const recommendations = [];

    if (this.results.unitTests?.failed > 0) {
      recommendations.push({
        priority: 'high',
        category: 'unit_tests',
        issue: `${this.results.unitTests.failed} unit test(s) are failing`,
        action: 'Review failing tests and fix implementation issues',
        affectedTests: this.extractFailedTestNames()
      });
    }

    if (this.results.unitTests?.passRate && parseFloat(this.results.unitTests.passRate) < 90) {
      recommendations.push({
        priority: 'medium',
        category: 'test_coverage',
        issue: `Test pass rate is ${this.results.unitTests.passRate}`,
        action: 'Investigate and fix failing tests to improve reliability'
      });
    }

    recommendations.push({
      priority: 'medium',
      category: 'gpu_tests',
      issue: 'GPU performance tests require browser environment',
      action: 'Run GPU tests manually in browser (see Next Steps section)'
    });

    return recommendations;
  }

  extractFailedTestNames() {
    if (!this.results.unitTests?.output) return [];
    
    const failedTests = [];
    const lines = this.results.unitTests.output.split('\n');
    
    for (const line of lines) {
      if (line.includes('FAIL') && line.includes('tests/')) {
        const match = line.match(/tests\/[^\s]+/);
        if (match) {
          failedTests.push(match[0]);
        }
      }
    }
    
    return [...new Set(failedTests)]; // Remove duplicates
  }

  generateNextSteps() {
    return [
      {
        step: 1,
        title: 'Review Unit Test Results',
        description: 'Check PERFORMANCE_TEST_REPORT.md for detailed unit test results',
        command: 'npm test'
      },
      {
        step: 2,
        title: 'Run GPU Performance Tests (Browser)',
        description: 'GPU tests require a browser environment with WebGPU support',
        instructions: [
          '1. Start the development server:',
          '   - Windows: START_SERVER.bat',
          '   - Linux/Mac: ./START_SERVER.sh',
          '   - Or manually: python rhizo_server.py',
          '',
          '2. Open the application in a browser:',
          '   - Navigate to: http://127.0.0.1:5000/studio',
          '   - Or open: examples/gpu-performance-demo.html',
          '',
          '3. Open browser console (F12) and run:',
          '   await window.gpuPerformanceTest?.runAllTests();',
          '',
          '4. Or use the interactive demo page:',
          '   - Open: examples/gpu-performance-demo.html',
          '   - Click "Run All Tests" button',
          '',
          '5. Results will be displayed in console and on the page'
        ]
      },
      {
        step: 3,
        title: 'Run Performance Benchmarks',
        description: 'Run comprehensive performance benchmarks for throttled scenarios',
        instructions: [
          '1. In browser console, run:',
          '   const benchmark = window.performanceBenchmark;',
          '   const scenarios = PerformanceBenchmark.getThrottledScenarios();',
          '   await benchmark.runThrottledScenarios();',
          '',
          '2. Results will be available via:',
          '   benchmark.getTestResults()',
          '   benchmark.exportResults()'
        ]
      },
      {
        step: 4,
        title: 'Monitor Real-time Performance',
        description: 'Use the profiler overlay to monitor performance during development',
        instructions: [
          '1. Press Ctrl+P to toggle profiler overlay',
          '2. Monitor FPS, frame time, and compute dispatch info',
          '3. Check for performance warnings (red indicators)',
          '4. Target: 60 FPS (16.67ms frame time)'
        ]
      }
    ];
  }

  generateMarkdownReport(report) {
    const summary = report.summary;
    const statusEmoji = {
      'good': '✅',
      'needs_attention': '⚠️',
      'error': '❌',
      'unknown': '❓'
    };

    let md = `# Performance Test Report\n\n`;
    md += `**Generated:** ${new Date(report.timestamp).toLocaleString()}\n\n`;
    md += `**Overall Status:** ${statusEmoji[summary.overallStatus] || '❓'} ${summary.overallStatus.toUpperCase()}\n\n`;
    md += `---\n\n`;

    // Unit Tests Section
    md += `## Unit Tests (Vitest)\n\n`;
    if (report.unitTests) {
      md += `- **Status:** ${report.unitTests.status.toUpperCase()}\n`;
      md += `- **Passed:** ${report.unitTests.passed}/${report.unitTests.total}\n`;
      md += `- **Failed:** ${report.unitTests.failed}\n`;
      md += `- **Pass Rate:** ${report.unitTests.passRate}\n\n`;

      if (report.unitTests.failed > 0) {
        md += `### Failed Tests\n\n`;
        const failedTests = this.extractFailedTestNames();
        if (failedTests.length > 0) {
          failedTests.forEach(test => {
            md += `- \`${test}\`\n`;
          });
          md += `\n`;
        }
      }
    } else {
      md += `- **Status:** NOT RUN\n\n`;
    }

    // GPU Tests Section
    md += `## GPU Performance Tests\n\n`;
    md += `- **Status:** ${report.gpuTests.status.toUpperCase()}\n`;
    md += `- **Note:** ${report.gpuTests.note}\n\n`;
    md += `GPU tests require a browser environment with WebGPU support. See "Next Steps" section for instructions.\n\n`;

    // Summary Section
    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Overall Status | ${summary.overallStatus} |\n`;
    md += `| Unit Tests | ${summary.passedTests}/${summary.totalTests} passed (${summary.passRate}) |\n`;
    md += `| GPU Tests | ${summary.gpuTestsStatus} |\n\n`;

    // Recommendations Section
    if (report.recommendations && report.recommendations.length > 0) {
      md += `## Recommendations\n\n`;
      report.recommendations.forEach((rec, idx) => {
        const priorityEmoji = {
          'high': '🔴',
          'medium': '🟡',
          'low': '🟢'
        };
        md += `### ${idx + 1}. ${priorityEmoji[rec.priority] || '⚪'} ${rec.issue}\n\n`;
        md += `**Category:** ${rec.category}\n\n`;
        md += `**Action:** ${rec.action}\n\n`;
        if (rec.affectedTests && rec.affectedTests.length > 0) {
          md += `**Affected Tests:**\n`;
          rec.affectedTests.forEach(test => {
            md += `- \`${test}\`\n`;
          });
          md += `\n`;
        }
      });
    }

    // Next Steps Section
    md += `## Next Steps\n\n`;
    report.nextSteps.forEach(step => {
      md += `### Step ${step.step}: ${step.title}\n\n`;
      md += `${step.description}\n\n`;
      
      if (step.command) {
        md += `\`\`\`bash\n${step.command}\n\`\`\`\n\n`;
      }
      
      if (step.instructions) {
        step.instructions.forEach(instruction => {
          md += `${instruction}\n`;
        });
        md += `\n`;
      }
    });

    // Test Details Section
    if (report.unitTests?.output) {
      md += `## Detailed Test Output\n\n`;
      md += `<details>\n<summary>Click to expand full test output</summary>\n\n`;
      md += `\`\`\`\n${report.unitTests.output}\n\`\`\`\n\n`;
      md += `</details>\n\n`;
    }

    md += `---\n\n`;
    md += `*Report generated by Performance Test Runner*\n`;

    return md;
  }

  /**
   * Run all tests and generate report
   */
  async run() {
    console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    Performance Test Runner                                    ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

    // Run unit tests
    this.runUnitTests();

    // Generate report
    const report = this.generateReport();

    // Print summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`Overall Status: ${report.summary.overallStatus.toUpperCase()}`);
    console.log(`Unit Tests: ${report.summary.passedTests}/${report.summary.totalTests} passed (${report.summary.passRate})`);
    console.log(`GPU Tests: ${report.summary.gpuTestsStatus} (requires browser)\n`);

    if (report.recommendations.length > 0) {
      console.log('Top Recommendations:');
      report.recommendations.slice(0, 3).forEach((rec, idx) => {
        console.log(`  ${idx + 1}. ${rec.issue}`);
      });
      console.log('');
    }

    console.log('See PERFORMANCE_TEST_REPORT.md for detailed information and next steps.\n');

    return report;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new PerformanceTestRunner();
  runner.run().catch(error => {
    console.error('Error running performance tests:', error);
    process.exit(1);
  });
}

export { PerformanceTestRunner };

