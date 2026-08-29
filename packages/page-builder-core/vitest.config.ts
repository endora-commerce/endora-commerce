// This package's own test run. What is new here is the `mergeConfig(baseConfig,
// …)`: `vitest.config.base.ts` is where issue #255's foreign-workspace-link
// refusal lives, and a configuration that does not merge it never asks the
// question. Measured 2026-08-28: this file existed and did not merge the base,
// so the run was green, complete, and resolving `@endora-commerce/*` through
// whatever `node_modules` symlink it was handed — a shape no reader of a
// configuration file would suspect, because the file is there.
//
// That matters here for a reason the other packages do not have: this package
// is a **peer** dependency of `cms-components` and `email-components` and ships
// React contexts and hooks, so a run resolving another checkout's copy of it is
// a provider from one copy against a consumer from the other.
//
// `environment` and `include` are unchanged; the base supplies reporters,
// timeouts and coverage settings shared with every other workspace.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'page-builder-core',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }),
);
