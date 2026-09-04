// This module package's own test run (feature 106, `specs/106-module-owned-tests/`).
//
// The package carries the unit tests that need no booted server beside the
// sources they cover. Two things here are load-bearing rather than boilerplate:
//
//   * **`mergeConfig(baseConfig, …)`** — the base is the one file every
//     workspace's vitest configuration merges, and it is where issue #255's
//     foreign-workspace-link refusal lives. A configuration that skipped it
//     would let this package's run execute *another checkout's* sources while
//     reporting on this branch.
//   * **no `--passWithNoTests`, anywhere** — neither here nor in the generated
//     `test` script. A run that collects zero files from a package that ships
//     them must exit non-zero, or the repair reproduces the defect it fixes.
//
// The tests stay out of `tsconfig.build.json`'s emit (they import `vitest`, a
// devDependency no consumer installs); `vitest` transpiles them itself.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'mod-credit-limits',
      environment: 'node',
      // Both roots the layout contract allows: co-located beside the source,
      // and the package-owned `test/unit/` tree it declares in §1.
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    },
  }),
);
