// The fast half of the backend suite (issue #211): every unit test the backend
// has, minus the 16 that talk to a live Postgres or Redis, plus the two outer
// tests named in `test/service-free-outer-tests.ts`. Needs no Postgres, no
// Redis and no Meilisearch, so it runs in a CI job with no service containers,
// against the better part of an hour for the complete suite. The run prints its
// own file and test counts, and the printed figure is the only current one —
// this header carried "324 files in 96 s" while the run reported 349 and 436.
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
import { SERVICE_FREE_OUTER_TEST_PATHS } from './test/service-free-outer-tests.js';

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
      // `test/unit`, plus the unit tests that live beside the source they
      // cover. Those are the same kind of test and reach nothing either; they
      // were only ever in the hour-long job because no other job existed.
      //
      // The third entry is a **declaration and not a directory** (feature 112,
      // FR-007). A directory could not carry it: `test/contract` holds 386
      // files, 31 of which need no service, and the tree a file sits in is a
      // statement about its *scope* — Constitution III's (b), a public API's
      // shape — never about what it dials. So the two files named in
      // `test/service-free-outer-tests.ts` join this run one by one, with the
      // reason each earns a place on every merge request, in the exact mirror
      // of the exclusions above.
      include: [
        'test/unit/**/*.test.ts',
        'src/**/*.test.ts',
        ...SERVICE_FREE_OUTER_TEST_PATHS,
      ],
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
          // `test/unit/harness/heap-headroom.test.ts` measures a post-GC heap.
          // It named `test/unit/kernel/scope-retention.test.ts` until that file
          // moved into `@endora-commerce/platform` with the rest of the
          // platform's own unit tests (`specs/110-instance-repository/`, T119a),
          // where `packages/platform/vitest.config.ts` passes the same flag. The
          // flag is still needed here; the file that needs it is a different one.
          execArgv: ['--expose-gc'],
        },
      },
    },
  }),
);
