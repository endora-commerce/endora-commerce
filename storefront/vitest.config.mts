import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react',
    },
    test: {
      name: 'storefront',
      environment: 'node',
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }),
);
