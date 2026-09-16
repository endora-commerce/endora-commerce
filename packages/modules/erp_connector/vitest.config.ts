// This module package's own test run (feature 106, `specs/106-module-owned-tests/`).
//
// Two things here are load-bearing rather than boilerplate:
//
//   * **`mergeConfig(baseConfig, …)`** — the base is the one file every
//     workspace's vitest configuration merges, and it is where issue #255's
//     foreign-workspace-link refusal lives. A configuration that skipped it
//     would let this package's run execute *another checkout's* sources while
//     reporting on this branch.
//   * **no `--passWithNoTests`, anywhere** — neither here nor in the generated
//     `test` script. A run that collects zero files from a package that ships
//     them must exit non-zero.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'mod-erp-connector',
      environment: 'node',
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    },
  }),
);
