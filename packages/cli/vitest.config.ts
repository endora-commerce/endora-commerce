// This package's own test run.
//
// `mergeConfig(baseConfig, …)` is not boilerplate: the base is the one file
// every workspace's vitest configuration merges, and it is where issue #255's
// foreign-workspace-link refusal lives. A configuration that skipped it would
// let this package's run execute *another checkout's* sources while reporting on
// this branch — and `backend/test/unit/harness/workspace-resolution.test.ts`'s
// `runsOutsideTheGuard` reports a member that invokes vitest without one.
//
// No `--passWithNoTests`, here or in the `test` script: a run that collects zero
// files from a package that ships them must exit non-zero.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'cli',
      environment: 'node',
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    },
  }),
);
