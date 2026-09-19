// Backend test options shared by the two configs that run this suite:
// `vitest.config.ts` (complete: unit + contract + integration, needs Postgres,
// Redis and Meilisearch) and `vitest.unit.config.ts` (fast: unit only, needs
// nothing). One source, so a timeout or a pool setting cannot drift between the
// run a developer does and the run CI does.

import { mergeConfig, type UserConfig } from 'vitest/config';

import { RunCompletenessReporter } from './test/run-completeness.js';

const isCi = process.env['CI'] === 'true' || process.env['CI'] === '1';

/** Whatever a vitest config may put under `test.reporters`. */
type Reporters = NonNullable<NonNullable<UserConfig['test']>['reporters']>;

/**
 * A reporter list with each **name** appearing once, in the order it first did.
 *
 * The union is over names and over nothing else. A reporter *instance* is a
 * distinct listener by construction — two of them are two objects — so they are
 * all kept, which is what makes {@link RunCompletenessReporter} survive
 * {@link mergeBackendConfig} rather than depend on where it sits in the list.
 */
export function unionReporters(reporters: Reporters): Reporters {
  if (!Array.isArray(reporters)) return reporters;

  const seen = new Set<string>();
  const union: unknown[] = [];
  for (const entry of reporters as readonly unknown[]) {
    if (typeof entry === 'string') {
      if (seen.has(entry)) continue;
      seen.add(entry);
    }
    union.push(entry);
  }
  return union as Reporters;
}

/**
 * The backend's merge of the repository-wide base config. It differs from
 * `mergeConfig` in exactly one place: **reporters compose as a union, not as a
 * concatenation.**
 *
 * Vite's `mergeConfig` concatenates arrays. For `include`, `exclude` and
 * `setupFiles` that is the right algebra — each contributor adds to a list. For
 * `reporters` it is the wrong one: the list is a set of listeners, and a name
 * appearing twice is a second listener printing every line a second time.
 * `vitest.config.base.ts` contributes `['default', 'junit']` under CI and
 * {@link backendTestOptions} contributes `['default', <completeness>]`, so what
 * a CI shard actually ran was `['default', 'junit', 'default', <completeness>]`
 * and every line of its log appeared twice.
 *
 * The cost is not cosmetic. GitLab stops collecting a job's output at 4 MB and
 * vitest prints its failure summary **last**, so a doubled log that crosses the
 * limit takes the summary with it. Shard 2 of pipeline 11478 and shard 3 of
 * 13573 both ended in `Job's log exceeded limit of 4194304 bytes` and named no
 * failing test; under D-198 no merge-request pipeline creates `test:backend` at
 * all, so the nightly is the only place the complete suite runs and that log is
 * the only record it leaves. Halving the reporter's output is half the repair.
 * The other half is the junit report `test:backend` now uploads as an artifact,
 * which survives the log entirely.
 *
 * Two things this does not do. It does not make a shard's log *small* — on a
 * measured 293-file shard the reporter is a minority of it, and the largest
 * single contributor is the `tenant.escape_hatch` audit line each booting file
 * emits once per module, which is a separate judgement with a different owner.
 * And it does not decide the reporter set: the base's entries keep their places
 * and the backend's additions follow, so a reporter added to either file still
 * arrives.
 *
 * `backend/test/unit/harness/vitest-reporters.test.ts` holds both halves.
 */
export function mergeBackendConfig(base: UserConfig, override: UserConfig): UserConfig {
  const merged = mergeConfig(base, override) as UserConfig;
  const test = merged.test;
  if (test === undefined) return merged;

  const { reporters } = test;
  if (reporters === undefined) return merged;

  return { ...merged, test: { ...test, reporters: unionReporters(reporters) } };
}

/**
 * The contracts package's **built** output is loaded by node, once, and not by
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
 * completion, and collection drops from 50.8 s to 26.5 s over thirty files.
 *
 * **It names one package rather than `packages/*`, and that is a measurement
 * rather than caution.** `@endora-commerce/platform` owns process-wide
 * registries; externalizing it gives the whole shard one of each while vitest
 * goes on re-evaluating every module that registers into them once per test
 * file. Over 32 files importing `pim_ergonode`'s entities,
 * `tenantClassifications()` then holds 32 entries per class instead of one and
 * `test/unit/pim_ergonode/tenant-classification.test.ts` fails ten times.
 * Nothing about issue #199 needs that, and changing what a registry contains
 * for a whole run is a bigger decision than this one. The other four packages
 * are untouched because nothing measured them.
 * `test/unit/harness/workspace-package-externalization.test.ts` holds the scope
 * in both directions.
 *
 * Two things it does **not** do. It matches `dist` only, so a test that reads
 * the package's `src` as text is untouched; and an externalized module cannot
 * be `vi.mock`ed — no test in this suite mocks an `@endora-commerce/*`
 * specifier, and one that needs to should mock the seam it reaches rather than
 * the contracts barrel.
 */
const CONTRACTS_DIST = /\/packages\/contracts\/dist\//;

export function backendTestOptions(): NonNullable<UserConfig['test']> {
  return {
    environment: 'node',
    server: { deps: { external: [CONTRACTS_DIST] } },
    setupFiles: [
      './test/tenancy-setup.ts',
      // Issue #199 — the fork reports how close it is to its own heap limit
      // before it dies of it. See test/heap-headroom.ts.
      './test/heap-headroom-setup.ts',
      // `global-setup.ts` pins the generable secrets once, in the parent process,
      // and 36 files in this suite then overwrite one unconditionally while 38
      // delete it. Re-asserted per test file here; the measurements and the
      // reason this is not 74 edits are in test/pinned-secrets-setup.ts.
      './test/pinned-secrets-setup.ts',
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
    // **This list is united with the base one, not appended to it** — see
    // `mergeBackendConfig` above, which is how the three backend configs
    // compose. Naming `default` here is therefore a statement of what the
    // backend runs and not a second copy of what the base already said: it does
    // not drop the base's `junit` and it does not print the run twice. It did
    // until this was repaired, and the pair of `default`s is why every line of a
    // shard's log appeared twice — which is why shard 2 of pipeline 11478 and
    // shard 3 of 13573 hit GitLab's 4 MB log limit and stopped being readable.
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
