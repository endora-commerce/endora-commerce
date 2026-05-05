import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';
import path from 'node:path';

export default mergeConfig(
  baseConfig,
  defineConfig({
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      name: 'admin',
      environment: 'node',
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }),
);
