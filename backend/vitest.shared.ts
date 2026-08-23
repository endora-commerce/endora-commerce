// Backend test options shared by the two configs that run this suite:
// `vitest.config.ts` (complete: unit + contract + integration, needs Postgres,
// Redis and Meilisearch) and `vitest.unit.config.ts` (fast: unit only, needs
// nothing). One source, so a timeout or a pool setting cannot drift between the
// run a developer does and the run CI does.

import type { UserConfig } from 'vitest/config';

import { RunCompletenessReporter } from './test/run-completeness.js';

const isCi = process.env['CI'] === 'true' || process.env['CI'] === '1';

/**
 * A workspace package's **built** output is loaded by node, once, and not by
 * vite-node once per test file (issue #199).
 *
 * `shouldExternalize` in `vite-node` asks one question: does the resolved id
 * contain `/node_modules/`? A workspace package does not — pnpm links it and
 * vite resolves the link, so `@endora-commerce/contracts` arrives as
 * `<repo>/packages/contracts/dist/index.js` and is **inlined**: transformed,
 * cached in the vite module graph, and re-evaluated for every test file that
 * imports it. Measured on this repository, in the fork the whole suite shares:
 *
 *   - one evaluation of `@endora-commerce/contracts` retains **111 MB** — 1 384
 *     exports, almost all of them Zod schemas, 672 454 closures and 19 774
 *     property backing stores;
 *   - across twelve test files it was evaluated **ten** times;
 *   - at the moment the fork died of its 2 GB old-space cap, **6.4 of those
 *     copies were still reachable** — 71% of a 1 037 MB live set, counted four
 *     independent ways in a heap snapshot (`ZodString` 19 841/3 099, `ZodNumber`
 *     10 689/1 674, and Zod v4's `runChecks` / `handleCanaryResult` closures
 *     20 350/3 203 each).
 *
 * With the rule below, the same 120 files that died at 2 011 MB run to
 * completion at a 1 267 MB peak, and collection drops from 50.8 s to 26.5 s for
 * the same thirty files. `@endora-commerce/platform` was already externalized
 * (its ids carry no `/@fs/` prefix in the snapshot), which is the shape this
 * restores for the other five.
 *
 * Two things it does **not** do. It matches `dist` only, so a test that reads a
 * package's `src` as text is untouched; and an externalized module cannot be
 * `vi.mock`ed — no test in this suite mocks an `@endora-commerce/*` specifier,
 * and one that needs to should mock the seam it reaches rather than the
 * contracts barrel.
 */
const WORKSPACE_PACKAGE_DIST = /\/packages\/[^/]+\/dist\//;

export function backendTestOptions(): NonNullable<UserConfig['test']> {
  return {
    environment: 'node',
    server: { deps: { external: [WORKSPACE_PACKAGE_DIST] } },
    setupFiles: [
      './test/tenancy-setup.ts',
      // Issue #199 — the fork reports how close it is to its own heap limit
      // before it dies of it. See test/heap-headroom.ts.
      './test/heap-headroom-setup.ts',
    ],
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
    // Issue #199 — a run that did not execute every file it was given says so,
    // by name. See test/run-completeness.ts. Registered as an instance rather
    // than a module path so nothing has to resolve it.
    //
    // **This list is appended to the base one, not substituted for it.** Vite's
    // `mergeConfig` concatenates arrays, so what a CI shard actually runs is
    // `['default', 'junit', 'default', <this>]` — `vitest.config.base.ts`
    // contributes the first two. The pair of `default`s is why every line of a
    // shard's log appears twice, which is in turn why shard 2 of pipeline 11478
    // hit GitLab's 4 MB log limit and stopped being readable at all. It is left
    // alone here deliberately: this branch is about a run that ended early, and
    // changing what a green run prints belongs in its own change.
    //
    // The CI branch below used to set `reporters: ['default']` and
    // `outputFile: undefined` under a comment saying junit is off on a shard.
    // Both were inert for the same reason — `mergeConfig` concatenates the
    // first and skips a nullish override outright — and the CI log settles it:
    // `JUNIT report written to …/test-results.junit.xml` appears in every shard
    // of 11478. Removing them changes nothing at runtime and is what lets this
    // file be type-checked at all: it is outside `tsconfig.json`'s `include`,
    // so `outputFile: undefined` had never been held to
    // `exactOptionalPropertyTypes` until a test imported this function.
    reporters: ['default', new RunCompletenessReporter()],
    ...(isCi
      ? {
          teardownTimeout: 60_000,
          // Last resort: tests already green; don't fail the pipeline on IPC noise.
          // Fixed properly in vitest ≥4 (pool shutdown). Remove when upgraded.
          // dangerouslyIgnoreUnhandledErrors: true,
        }
      : {}),
  };
}
