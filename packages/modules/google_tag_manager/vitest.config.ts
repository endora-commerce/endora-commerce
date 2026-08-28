// This module package's own test run (feature 089, Phase 1).
//
// The package carries its unit tests beside the sources they cover, and until
// this file existed nothing collected them: no vitest configuration included
// `packages/**`, and `manifests:generate` emits a `test` script only for a
// package that declares one — so the files were reported by no job and counted
// in no total. Not failing; absent, which in review reads as coverage.
// `.gitlab-ci.yml`'s `test:frontend` job runs `pnpm --filter '!backend' run test`,
// so the emitted script is all it takes for them to be collected.
//
// Two things here are load-bearing rather than boilerplate:
//
//   * **`mergeConfig(baseConfig, …)`** — the base is the one file every
//     workspace's vitest configuration merges, and it is where issue #255's
//     foreign-workspace-link refusal lives. A configuration that skipped it
//     would let this package's run execute *another checkout's* sources while
//     reporting on this branch.
//   * **no `--passWithNoTests`, anywhere** — neither here nor in the generated
//     script. A run that collects zero files from a package that ships them
//     must exit non-zero, or the repair reproduces the defect it fixes.
//
// The tests stay out of `tsconfig.build.json`'s emit (they import `vitest`, a
// devDependency no consumer installs); `vitest` transpiles them itself.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'mod-google-tag-manager',
      environment: 'node',
      // Both roots the layout contract allows: co-located beside the source,
      // and the package-owned `test/unit/` tree it declares in §1.
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    },
  }),
);
