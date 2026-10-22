/**
 * The complete-suite test files that must not run beside another file, named
 * with a reason each.
 *
 * The complete suite runs its files on several workers, each with its own
 * database and its own Redis logical database (see `test/test-workers.ts`).
 * That isolates everything a worker can own. It does not isolate what the
 * machine has one of — the Meilisearch instance, the CPU a timing budget or a
 * cold child-process start is measured against — and the files below lean on
 * exactly that. `vitest.config.ts` runs them in a second project,
 * `backend-serial`, one at a time and in a scheduling group of their own, so
 * no other file is running while they do.
 *
 * **Redis pub/sub is not a reason to be here**, although Redis does not scope
 * channels by logical database and every worker therefore hears every other
 * worker's module-state and cache-invalidation announcements. Each subscriber
 * answers one by re-reading its **own** database or dropping its own cache
 * entry, so a foreign announcement costs a refresh and changes no answer —
 * measured: all of `test/integration/_lifecycle` and the pub/sub files under
 * `kernel` and `admin_actions` pass in the parallel project. A test that
 * asserted that *no* announcement arrived would belong here.
 *
 * Every entry is either an exact `backend/`-relative path or a directory
 * followed by `/**`, so the same strings serve as vitest globs and as the
 * prefixes `test/unit/harness/serial-test-files.test.ts` matches them with.
 * That file keeps the list honest in both directions: an entry that matches
 * nothing fails, and a file that meets one of the rules in
 * {@link SERIAL_RULES} without being covered fails too.
 */

export interface SerialTestEntry {
  /** An exact `backend/`-relative path, or a `backend/`-relative directory followed by `/**`. */
  readonly pattern: string;
  /** What the files share with every other file, which a worker cannot own. */
  readonly reason: string;
}

export const SERIAL_TEST_FILES: readonly SerialTestEntry[] = [
  {
    pattern: 'test/contract/search/**',
    reason:
      'Search-module contract files write and read the one Meilisearch instance every worker ' +
      'shares; an index another worker is filling at the same moment is not their fixture.',
  },
  {
    pattern: 'test/integration/search/**',
    reason:
      'Indexes products into the one shared Meilisearch instance and asserts what a query over ' +
      'it returns, which another worker indexing at the same moment would change.',
  },
  {
    pattern: 'test/integration/_lifecycle/non-binding-degradation.integration.test.ts',
    reason:
      'Switches the catalogue listing to Meilisearch (CATALOG_SEARCH_BACKEND=meilisearch) and ' +
      'asserts how it degrades, against the one search instance every worker shares.',
  },
  ...[
    'cli-disable',
    'cli-enable',
    'cli-install',
    'cli-status',
    'cli-uninstall',
  ].map((name) => ({
    pattern: `test/contract/_lifecycle/${name}.contract.test.ts`,
    reason:
      'Spawns a module:* lifecycle CLI through `pnpm exec tsx` once per case — a cold TypeScript ' +
      'start each, with case timeouts sized for a machine that is not also running five workers.',
  })),
  {
    pattern: 'test/integration/_lifecycle/uninstall-hard-needs-force.integration.test.ts',
    reason:
      'Spawns `module:uninstall --hard` as a child process against the database, the lifecycle ' +
      'CLI path end to end, with the same cold-start timing as the contract CLI files.',
  },
  {
    pattern: 'test/integration/price_lists/fresh-install.test.ts',
    reason:
      'Feature 160 (T116) — takes a database of its own (a template clone) and spawns ' +
      '`module:install --all` into it as a child process: the lifecycle CLI path end to end, ' +
      'with the same cold-start timing as the contract CLI files.',
  },
  {
    pattern: 'test/integration/demo/**',
    reason:
      'Each file takes a database of its own (a template clone, or in the parity file a ' +
      'migration from empty) and spawns the demo pipeline or the migrator as child processes — ' +
      'a minute of CPU per file, with timeouts sized for a machine doing nothing else.',
  },
  {
    pattern: 'test/perf/**',
    reason: 'Performance budgets, measured in wall-clock time that other workers would steal.',
  },
];

/** The patterns alone, as vitest takes them. */
export const SERIAL_TEST_PATTERNS: readonly string[] = SERIAL_TEST_FILES.map(
  (entry) => entry.pattern,
);

/**
 * The rules that put a file on this list, as content tests — so a new file that
 * meets one cannot land in the parallel project unnoticed.
 */
export const SERIAL_RULES: readonly { readonly name: string; readonly test: RegExp }[] = [
  {
    name: 'queries the shared Meilisearch instance (sets CATALOG_SEARCH_BACKEND=meilisearch)',
    test: /CATALOG_SEARCH_BACKEND['"]\]\s*=\s*['"]meilisearch['"]/,
  },
  {
    name: 'spawns a module lifecycle CLI (src/lifecycle/scripts/)',
    test: /lifecycle\/scripts\//,
  },
];

/** Whether a `backend/`-relative path is covered by an entry's pattern. */
export function matchesSerialPattern(path: string, pattern: string): boolean {
  if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -2));
  return path === pattern;
}
