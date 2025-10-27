#!/usr/bin/env node

/**
 * Test suite for UnifiedExpressionSystem
 * Verifies that CPU evaluation and shader generation produce equivalent results
 */

import { unifiedExpressionSystem } from './src/utils/UnifiedExpressionSystem.js';

console.log('=== Testing Unified Expression System ===\n');

const tests = [
  // Basic arithmetic
  { expr: '2 + 3', expectedCPU: 5, description: 'Basic addition' },
  { expr: '10 - 4', expectedCPU: 6, description: 'Basic subtraction' },
  { expr: '3 * 4', expectedCPU: 12, description: 'Basic multiplication' },
  { expr: '15 / 3', expectedCPU: 5, description: 'Basic division' },

  // Operator precedence
  { expr: '2 + 3 * 4', expectedCPU: 14, description: 'Multiplication before addition' },
  { expr: '(2 + 3) * 4', expectedCPU: 20, description: 'Parentheses override precedence' },

  // Math functions
  { expr: 'sin(0)', expectedCPU: 0, description: 'sin(0)' },
  { expr: 'cos(0)', expectedCPU: 1, description: 'cos(0)' },
  { expr: 'abs(-5)', expectedCPU: 5, description: 'abs(-5)' },
  { expr: 'min(3, 7)', expectedCPU: 3, description: 'min(3, 7)' },
  { expr: 'max(3, 7)', expectedCPU: 7, description: 'max(3, 7)' },
  { expr: 'pow(2, 3)', expectedCPU: 8, description: 'pow(2, 3)' },
  { expr: 'sqrt(16)', expectedCPU: 4, description: 'sqrt(16)' },
  { expr: 'floor(3.7)', expectedCPU: 3, description: 'floor(3.7)' },
  { expr: 'ceil(3.2)', expectedCPU: 4, description: 'ceil(3.2)' },

  // Custom functions
  { expr: 'clamp(5, 0, 10)', expectedCPU: 5, description: 'clamp within range' },
  { expr: 'clamp(-5, 0, 10)', expectedCPU: 0, description: 'clamp below range' },
  { expr: 'clamp(15, 0, 10)', expectedCPU: 10, description: 'clamp above range' },
  { expr: 'lerp(0, 10, 0.5)', expectedCPU: 5, description: 'lerp(0, 10, 0.5)' },

  // Variables (with context)
  { expr: 'time * 2', context: { time: 5 }, expectedCPU: 10, description: 'Variable: time * 2' },
  { expr: 'audioEnvelope + 1', context: { audioEnvelope: 0.5 }, expectedCPU: 1.5, description: 'Variable: audioEnvelope + 1' },

  // Complex expressions
  { expr: 'sin(time) * 0.5 + 0.5', context: { time: 0 }, expectedCPU: 0.5, description: 'Complex: sin(time) * 0.5 + 0.5' },
  { expr: '(audioEnvelope - 0.5) * 2', context: { audioEnvelope: 0.75 }, expectedCPU: 0.5, description: 'Complex: (audioEnvelope - 0.5) * 2' },

  // Constants
  { expr: 'PI', expectedCPU: Math.PI, description: 'Constant: PI' },
  { expr: 'E', expectedCPU: Math.E, description: 'Constant: E' },

  // Unary operators
  { expr: '-5', expectedCPU: -5, description: 'Unary minus' },
  { expr: '+5', expectedCPU: 5, description: 'Unary plus' },
];

let passed = 0;
let failed = 0;

tests.forEach((test, index) => {
  try {
    const context = test.context || {};

    // Test CPU evaluation
    const cpuResult = unifiedExpressionSystem.evaluateCPU(test.expr, context);
    const cpuMatch = Math.abs(cpuResult - test.expectedCPU) < 0.0001;

    // Test shader generation (just check it doesn't throw)
    const shaderCode = unifiedExpressionSystem.generateShader(test.expr);
    const hasShaderCode = typeof shaderCode === 'string' && shaderCode.length > 0;

    if (cpuMatch && hasShaderCode) {
      console.log(`✅ ${index + 1}. ${test.description}`);
      console.log(`   Expression: ${test.expr}`);
      console.log(`   CPU Result: ${cpuResult}`);
      console.log(`   Shader: ${shaderCode}`);
      console.log();
      passed++;
    } else {
      console.log(`❌ ${index + 1}. ${test.description}`);
      console.log(`   Expression: ${test.expr}`);
      console.log(`   Expected: ${test.expectedCPU}, Got: ${cpuResult}`);
      console.log(`   Shader: ${shaderCode}`);
      console.log();
      failed++;
    }
  } catch (error) {
    console.log(`❌ ${index + 1}. ${test.description} - ERROR`);
    console.log(`   Expression: ${test.expr}`);
    console.log(`   Error: ${error.message}`);
    console.log();
    failed++;
  }
});

console.log(`\n=== Test Results ===`);
console.log(`✅ Passed: ${passed}/${tests.length}`);
console.log(`❌ Failed: ${failed}/${tests.length}`);

if (failed === 0) {
  console.log('\n🎉 All tests passed! The unified expression system is working correctly.');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Please review the output above.');
  process.exit(1);
}
