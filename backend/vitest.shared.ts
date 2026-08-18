// Backend test options shared by the two configs that run this suite:
// `vitest.config.ts` (complete: unit + contract + integration, needs Postgres,
// Redis and Meilisearch) and `vitest.unit.config.ts` (fast: unit only, needs
// nothing). One source, so a timeout or a pool setting cannot drift between the
// run a developer does and the run CI does.

import type { UserConfig } from 'vitest/config';

const isCi = process.env['CI'] === 'true' || process.env['CI'] === '1';

export function backendTestOptions(): NonNullable<UserConfig['test']> {
  return {
    environment: 'node',
    setupFiles: ['./test/tenancy-setup.ts'],
    // Forces DATABASE_URL → b2b_test, auto-creates the DB on first run, and
    // applies migrations — unless the run declared BACKEND_TEST_SERVICES=none,
    // in which case it applies the deterministic env keys and stops. Runs once
    // in the parent process before any worker fork; workers inherit the env.
    // See test/global-setup.ts.
    globalSetup: ['./test/global-setup.ts'],
    // Integration/contract tests share a single Postgres database. Running
    // test files in parallel would race on truncate+seed — pin to a single
    // fork so they execute serially inside one worker.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        // `--expose-gc` is what makes `test/integration/kernel/heap-ceiling.test.ts`
        // possible: a post-GC `heapUsed` reading separates live data from
        // garbage, and without a forced GC the number is noise. It lives here
        // rather than in the `test` script so a targeted run, a CI shard and an
        // IDE run all measure the same thing. V8 exposes the function; it does
        // not change how the heap is managed.
        execArgv: ['--expose-gc'],
      },
    },
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    ...(isCi
      ? {
          // Junit + tinypool fork shutdown race → spurious `write EPIPE` after all
          // tests passed (vitest 2.x). Default reporter only on CI shards; GitLab
          // still gets pass/fail from the job exit code.
          reporters: ['default'],
          outputFile: undefined,
          teardownTimeout: 60_000,
          // Last resort: tests already green; don't fail the pipeline on IPC noise.
          // Fixed properly in vitest ≥4 (pool shutdown). Remove when upgraded.
          // dangerouslyIgnoreUnhandledErrors: true,
        }
      : {}),
  };
}
