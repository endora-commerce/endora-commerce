// This package's own run. `mergeConfig(baseConfig, …)` is the workspace's one
// base configuration, where issue #255's foreign-workspace-link refusal lives.
// The tests here need no service: what touches a database is
// `backend/test/integration/demo/`, which composes a platform to run them.
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'demo-composition',
      environment: 'node',
      include: ['src/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**'],
    },
  }),
);
