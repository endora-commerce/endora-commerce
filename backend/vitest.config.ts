// The complete backend suite: unit + contract + integration + benchmarks.
// Needs Postgres, Redis and Meilisearch. `vitest.unit.config.ts` is the fast
// half of the same suite and needs none of them — see the header there.
//
// Two projects, run one after the other:
//
//   - `backend` — every file but the serial ones, on `BACKEND_TEST_WORKERS`
//     workers (6 locally, 1 under CI), each with its own database and Redis
//     logical database (`test/test-workers.ts`);
//   - `backend-serial` — the files named in `test/serial-test-files.ts`, one at
//     a time and in a group of their own, because what they lean on is
//     something the machine has only one of.
//
// The projects are written out rather than `extends: true`: inheriting the root
// would inherit its `globalSetup` too, and vitest runs a project's global setup
// once per project — two leases, the second overwriting the first's
// `DATABASE_URL`. The global setup and the reporters therefore sit on the root,
// which vitest always runs exactly once, and each project takes everything else.

import { configDefaults, defineConfig, type ViteUserConfig as UserConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';
import { BACKEND_TRANSFORM, backendTestOptions, mergeBackendConfig } from './vitest.shared.js';
import { SERIAL_TEST_PATTERNS } from './test/serial-test-files.js';
import { backendTestWorkers } from './test/test-workers.js';

type TestOptions = NonNullable<UserConfig['test']>;

const merged = mergeBackendConfig(baseConfig, defineConfig({ test: backendTestOptions() }));
const {
  globalSetup,
  reporters,
  outputFile,
  coverage,
  teardownTimeout,
  ...projectOptions
}: TestOptions = merged.test ?? {};

const workers = backendTestWorkers();

const include = ['test/**/*.test.ts', 'test/**/*.bench.ts', 'test/**/*.perf.ts', 'src/**/*.test.ts'];
// `test/release/` needs **git**, and every backend job runs in
// `node:22.18-slim`, which has none. It is run by `release:changeset`
// through `vitest.release.config.ts` — see that file's header, and
// `check-release-intent.test.ts`, which fails if the job stops naming it.
const exclude = [...configDefaults.exclude, 'test/release/**'];

export default defineConfig({
  ...BACKEND_TRANSFORM,
  test: {
    ...(globalSetup !== undefined ? { globalSetup } : {}),
    ...(reporters !== undefined ? { reporters } : {}),
    ...(outputFile !== undefined ? { outputFile } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
    ...(teardownTimeout !== undefined ? { teardownTimeout } : {}),
    projects: [
      {
        ...BACKEND_TRANSFORM,
        test: {
          ...projectOptions,
          name: 'backend',
          include,
          exclude: [...exclude, ...SERIAL_TEST_PATTERNS],
          maxWorkers: workers,
          fileParallelism: workers > 1,
          sequence: { groupOrder: 0 },
        },
      },
      {
        ...BACKEND_TRANSFORM,
        test: {
          ...projectOptions,
          name: 'backend-serial',
          include: [...SERIAL_TEST_PATTERNS],
          exclude,
          maxWorkers: 1,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
