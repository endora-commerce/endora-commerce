// The complete backend suite: unit + contract + integration + benchmarks.
// Needs Postgres, Redis and Meilisearch. `vitest.unit.config.ts` is the fast
// half of the same suite and needs none of them — see the header there.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';
import { backendTestOptions } from './vitest.shared.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      include: ['test/**/*.test.ts', 'test/**/*.bench.ts', 'src/**/*.test.ts'],
      ...backendTestOptions(),
    },
  }),
);
