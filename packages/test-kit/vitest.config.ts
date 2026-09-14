// This package's own **service-free** run (feature 109, Phase 1b).
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
//
// **Why there are two configurations and not one.** `pnpm run test` is what CI's
// `test:frontend` job invokes across every non-backend member, in a
// `node:22.18-slim` image with no service containers at all. A kit test that
// composes a real server needs a real PostgreSQL and a real Redis — the plan
// says so in as many words, and an in-memory substitute would test a platform
// nobody runs. So this configuration carries the tests that need nothing, and
// `vitest.services.config.ts` carries the ones that do. Neither skips: the
// service-bound run declares its services by being invoked, and its files are
// outside this configuration's `include` rather than guarded by a condition
// that could quietly become false.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'test-kit',
      environment: 'node',
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', 'test/services/**'],
    },
  }),
);
