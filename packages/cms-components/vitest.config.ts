// This package's own test run — and the reason it needs a configuration file at
// all (issue #255).
//
// `vitest.config.base.ts` is where the foreign-workspace-link refusal lives: a
// run whose `@endora-commerce/*` links re-root at **another checkout** compiles
// and executes that branch while reporting on this one, and the refusal is
// evaluated when the base config is imported. A package with no vitest
// configuration loads no base, so it never asks the question. Measured
// 2026-08-28: this package ran on vitest's defaults, green, with no
// `[workspace-resolution] read:` line anywhere in its output — while declaring
// `@endora-commerce/page-builder-core`, whose contexts and hooks it renders
// against.
//
// Nothing here narrows the run: `include` is deliberately left at vitest's
// default, so the collected population is the same 14 files it was before this
// file existed. A hand-written include list would be one more list that is right
// when written and silently stops being complete — and would drop the first
// `.test.tsx` anybody adds beside a component.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'cms-components',
      environment: 'node',
    },
  }),
);
