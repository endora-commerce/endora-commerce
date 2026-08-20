/**
 * The unit tests that need a live external service, named one by one.
 *
 * `test/unit` is 315 files and 16 of them talk to Postgres or Redis. That
 * minority is why the whole directory has, until now, been gated behind a
 * `globalSetup` that creates and migrates a database — so a developer or a CI
 * job that wanted the other 299 paid for three service containers to run them
 * (issue #211).
 *
 * This list is the partition. `vitest.unit.config.ts` excludes exactly these
 * files, which is what lets the fast run declare it needs no services at all.
 * Every entry is still executed by the complete run
 * (`pnpm --filter backend run test`, and `test:backend` in CI), so nothing here
 * loses coverage — it moves job, not out of the suite.
 *
 * **These files are not misfiled.** Each was read before it was listed: they
 * are unit-scope tests — one service, one registry, one resolver — that use a
 * real database instead of a mock because the thing under test is a query, a
 * JSONB scan or a reconciler, and a mocked EntityManager would assert the mock.
 * Three of them say so in their own header. Moving them to `test/integration`
 * would misdescribe them, so the split is declared here rather than performed
 * with `git mv`.
 *
 * `test/unit/harness/service-dependent-ledger.test.ts` keeps this list honest
 * in both directions: a new service-dependent unit test that is not listed
 * fails, and a listed file that no longer touches a service fails too — a stale
 * entry would silently keep a test out of the fast run forever.
 */

export interface ServiceDependentUnitTest {
  /** Path relative to `backend/`, exactly as vitest reports it. */
  readonly path: string;
  /** The external service the file cannot run without. */
  readonly needs: 'postgres' | 'redis';
  /** Why the file uses the real service rather than a double. */
  readonly reason: string;
}

export const SERVICE_DEPENDENT_UNIT_TESTS: readonly ServiceDependentUnitTest[] = [
  {
    path: 'test/unit/carts/cart-service.merge.test.ts',
    needs: 'postgres',
    reason:
      'Drives CartService.mergeAnonymousIntoCustomer directly and asserts the resulting ' +
      'rows; the merge outcome is defined by what the database ends up holding.',
  },
  {
    path: 'test/unit/catalog/catalog-admin-audit-emissions.test.ts',
    needs: 'postgres',
    reason:
      'Asserts the audit_log_entries rows create/archive emit, through the HTTP layer so ' +
      'the audit-context wiring is exercised end to end.',
  },
  {
    path: 'test/unit/catalog/catalog-admin-delete-guards.test.ts',
    needs: 'postgres',
    reason:
      'The delete guards are referential — they refuse when a cart row references the ' +
      'product — so the fixture is rows, not a stub.',
  },
  {
    path: 'test/unit/catalog/catalog-admin-update-product-status.test.ts',
    needs: 'postgres',
    reason:
      'The status/archivedAt cross-field rule lives in the service and is asserted over ' +
      'the persisted product; the PATCH route is the simplest fixture for it.',
  },
  {
    path: 'test/unit/catalog/product-attribute-mass-editable.test.ts',
    needs: 'postgres',
    reason:
      'Column default, persistence and partial-PATCH round-trip of Attribute.massEditable ' +
      '— all three are properties of the stored row.',
  },
  {
    path: 'test/unit/dictionaries/label-resolver.test.ts',
    needs: 'postgres',
    reason:
      'The locale fallback chain is resolved by a query over seeded dictionary_translations ' +
      'rows written by the real seed reconciler.',
  },
  {
    path: 'test/unit/dictionaries/validator-lru-invalidation.test.ts',
    needs: 'postgres',
    reason:
      'Invalidation is observed by re-reading through the validator after a write, so both ' +
      'sides of the cache need the real store behind them.',
  },
  {
    path: 'test/unit/dictionaries/validator-port.test.ts',
    needs: 'postgres',
    reason:
      'The validator answers from dictionary rows; a mocked EntityManager would assert the ' +
      'mock rather than the reference check.',
  },
  {
    path: 'test/unit/inventory/inventory-audit-emissions.test.ts',
    needs: 'postgres',
    reason:
      'Seven inventory mutations are checked for the audit row each one lands, including ' +
      'the CSV bulk import, which only exists as a database effect.',
  },
  {
    path: 'test/unit/megamenu/reference-registry.test.ts',
    needs: 'postgres',
    reason:
      'Its own header: the four scanners run against a real Postgres so the JSONB queries ' +
      'compile against the migrated shape.',
  },
  {
    path: 'test/unit/price_lists/price-list-audit-emissions.test.ts',
    needs: 'postgres',
    reason:
      'Lifecycle and content mutations are driven through HTTP and asserted as audit rows ' +
      'with an identity-bearing snapshot.',
  },
  {
    path: 'test/unit/price_lists/price-list-status-worker.test.ts',
    needs: 'postgres',
    reason:
      'Idempotency of the sweep is a property of two passes over the same rows; the second ' +
      'pass has to see what the first one wrote.',
  },
  {
    path: 'test/unit/settings/manifest-reconciler.test.ts',
    needs: 'postgres',
    reason:
      'Its own header: hosted under unit/ for organisation, on the real DB harness because ' +
      'the reconciler is hard to mock meaningfully.',
  },
  {
    path: 'test/unit/settings/settings-resolver.test.ts',
    needs: 'postgres',
    reason:
      'Its own header: hosted under unit/ for taxonomy, on the real test DB because the ' +
      'resolver is hard to mock cleanly.',
  },
  {
    path: 'test/unit/blog/blog-cache.test.ts',
    needs: 'redis',
    reason:
      'Exercises BlogCacheService against a live Redis, including a SCAN-based prefix sweep ' +
      'that an in-memory double would not reproduce.',
  },
  {
    path: 'test/unit/megamenu/megamenu-cache.test.ts',
    needs: 'redis',
    reason:
      'Exercises MegamenuCache against a live Redis, including the same SCAN-based ' +
      'invalidateAll sweep over the whole key namespace.',
  },
];

/** Paths only, in the shape vitest's `exclude` wants. */
export const SERVICE_DEPENDENT_UNIT_TEST_PATHS: readonly string[] =
  SERVICE_DEPENDENT_UNIT_TESTS.map((entry) => entry.path);
