// This package's own test run. `mergeConfig(baseConfig, …)` is where issue
// #255's foreign-workspace-link refusal lives, so a configuration that skipped
// it could execute another checkout's sources while reporting on this branch.
// No `--passWithNoTests`: a run that collects zero files must exit non-zero.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'create-endora-commerce',
      environment: 'node',
      include: ['test/**/*.test.ts'],
      // Two `pnpm pack` runs and a spawned CLI per case.
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
);
