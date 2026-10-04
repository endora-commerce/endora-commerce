import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';
import path from 'node:path';

export default mergeConfig(
  baseConfig,
  defineConfig({
    // The JSX transform is declared twice because `vitest` admits two major
    // versions of Vite and they do not read the same option: Vite 7 transforms
    // with esbuild, Vite 8 with oxc — and under Vite 8 an `esbuild` block is
    // ignored, so the transform falls back to the tsconfig's `jsx` setting.
    // Each version reads its own block and ignores the other.
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react',
    },
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'react' },
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
