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
      // jsdom is the default so interaction tests can drive @testing-library
      // (click, type, focus). Pure-logic tests opt out per-file with the
      // `// @vitest-environment node` annotation if needed; under jsdom they
      // still work — react-dom/server's `renderToString` is environment-agnostic.
      environment: 'jsdom',
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
      setupFiles: ['./test/setup.ts'],
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }),
);
