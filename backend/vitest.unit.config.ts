// The fast half of the backend suite (issue #211): every unit test the backend
// has, minus the 16 that talk to a live Postgres or Redis. Needs no Postgres,
// no Redis and no Meilisearch, so it runs in a CI job with no service
// containers — 324 files in 96 s, against the better part of an hour for the
// complete suite.
//
//   pnpm --filter backend run test:unit:fast    # this config
//   pnpm --filter backend run test              # the complete suite
//
// The exclusions are named one by one, with a reason each, in
// `test/service-dependent-unit-tests.ts`; every one of them still runs in the
// complete suite, so this is a split of jobs, not of coverage. Everything else
// in the two included roots is picked up by default, which is the direction
// that keeps this honest: a new service-dependent unit test lands here first
// and fails loudly at the harness seam, rather than being quietly left out.

import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';
import { backendTestOptions } from './vitest.shared.js';
import { SERVICE_DEPENDENT_UNIT_TEST_PATHS } from './test/service-dependent-unit-tests.js';

// Choosing this config *is* the declaration that the run has no services —
// which is why it is made here and not left to whoever writes the command line.
// `test/global-setup.ts` reads it and skips creating and migrating a database;
// `test/declared-services.ts` explains why the condition is a declaration and
// never a probe.
process.env['BACKEND_TEST_SERVICES'] = 'none';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend-unit',
      // `test/unit`, plus the 24 unit tests that live beside the source they
      // cover. Those are the same kind of test and reach nothing either; they
      // were only ever in the hour-long job because no other job existed.
      include: ['test/unit/**/*.test.ts', 'src/**/*.test.ts'],
      exclude: [...configDefaults.exclude, ...SERVICE_DEPENDENT_UNIT_TEST_PATHS],
      ...backendTestOptions(),
      // The one setting this config does NOT share with the complete suite.
      // `singleFork` exists there because contract and integration files share
      // one Postgres database and would race on truncate+seed. Nothing in this
      // run has a database to race on, and the alternative is not merely
      // slower: 299 files in one process reach the 4 GB V8 default and die with
      // `Ineffective mark-compacts near heap limit` around file 232 — the
      // per-file harness retention that `test:backend` pays for with five
      // shards and a `--max-old-space-size` cap. Separate forks bound it
      // structurally, each seeing a few dozen files instead of all of them.
      fileParallelism: true,
      poolOptions: {
        forks: {
          singleFork: false,
          // Sized for the 4 vCPU CI runner rather than a developer's laptop:
          // more forks means more concurrent module graphs, and the graph is
          // what costs memory here. `minForks` has to move with it — it
          // defaults to the host's CPU count, and tinypool refuses a minimum
          // above the maximum.
          minForks: 1,
          maxForks: 4,
          // `--expose-gc` for the same reason the complete suite passes it —
          // `test/unit/kernel/scope-retention.test.ts` measures a post-GC heap.
          execArgv: ['--expose-gc'],
        },
      },
    },
  }),
);
