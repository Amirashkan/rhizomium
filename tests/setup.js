/**
 * Vitest setup file
 * Initializes WebGPU mock for all tests
 */

import { setupWebGPUMock } from './webgpu-mock.js';

// Setup WebGPU mock before all tests
setupWebGPUMock();

// Make window available globally for tests
global.window = global.window || {};
