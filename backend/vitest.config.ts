// The complete backend suite: unit + contract + integration + benchmarks.
// Needs Postgres, Redis and Meilisearch. `vitest.unit.config.ts` is the fast
// half of the same suite and needs none of them — see the header there.

import { configDefaults, defineConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';
import { backendTestOptions, mergeBackendConfig } from './vitest.shared.js';

export default mergeBackendConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      include: ['test/**/*.test.ts', 'test/**/*.bench.ts', 'test/**/*.perf.ts', 'src/**/*.test.ts'],
      // `test/release/` needs **git**, and every backend job runs in
      // `node:22.18-slim`, which has none. It is run by `release:changeset`
      // through `vitest.release.config.ts` — see that file's header, and
      // `check-release-intent.test.ts`, which fails if the job stops naming it.
      exclude: [...configDefaults.exclude, 'test/release/**'],
      ...backendTestOptions(),
    },
  }),
);
