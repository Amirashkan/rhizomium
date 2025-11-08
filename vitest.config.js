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
      exclude: [
        'src/test/**',
        'src/gpu/examples/**',
        '**/*.test.js',
        '**/*.spec.js'
      ]
    },
    testTimeout: 10000
  }
});
