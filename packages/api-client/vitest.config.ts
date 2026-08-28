// This package's own test run — and the reason it needs a configuration file at
// all (issue #255).
//
// `vitest.config.base.ts` is where the foreign-workspace-link refusal lives: a
// run whose `@endora-commerce/*` links re-root at **another checkout** compiles
// and executes that branch while reporting on this one, and the refusal is
// evaluated when the base config is imported. A package with no vitest
// configuration loads no base, so it never asks the question.
//
// ## `passWithNoTests` is deliberate, and it is not the module packages' answer
//
// This package ships **no test file**. `pnpm --filter '!backend' run test`
// therefore reports `No test files found` for it and exits 0 only because the
// flag says to — the same vacuous green that MR !1089 removed from the four
// module packages, which is why the flag is stated here rather than left in the
// `test` script where nothing could say why it is there.
//
// It is kept, and the two facts are different. Those four packages **had** tests
// that nothing collected, so dropping the flag turned an absence into the pass
// it always should have been. This one has none at all: dropping the flag here
// makes the package red without writing a single test, which converts an open
// question — *should a hand-written HTTP client have its own tests, or is it
// covered by the admin and storefront suites that consume it?* — into a blocked
// pipeline. That question is a separate merge request and belongs to whoever
// answers it.
//
// **Delete this option in the merge request that adds the first test**, not
// before and not after: from that moment the flag would hide a run that
// collected nothing, which is the defect it is currently only declaring.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'api-client',
      environment: 'node',
      passWithNoTests: true,
    },
  }),
);
