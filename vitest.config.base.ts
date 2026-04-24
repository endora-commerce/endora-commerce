// Shared Vitest base configuration consumed by every workspace's local vitest.config.ts
// via `mergeConfig(baseConfig, ...)`. Keeps reporter, coverage, and timeouts consistent
// across backend + frontend + packages (Principle IV — one configuration, not three).

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: './test-results.junit.xml' },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/out/**',
        '**/coverage/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/test/**',
        '**/*.config.*',
        '**/*.d.ts',
      ],
    },
  },
});
