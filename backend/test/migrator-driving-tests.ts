/**
 * The test files that drive the real migrator against a live database, named
 * one by one (issue #189).
 *
 * ## Why this class exists at all
 *
 * Every other integration test mutates *rows*, inside a transaction the fixture
 * rolls back, or inside a truncate the next file repeats. A test that calls
 * `orm.getMigrator().up()` or `.down()` mutates the **schema**, outside any
 * such fixture, and leaves it changed for whatever runs next.
 *
 * That was survivable while every invocation shared one already-migrated
 * database: a file that reverted a migration and failed to re-apply it broke
 * the files after it, and the next run's `migrator.up()` put the schema back.
 * Since per-invocation isolation the database is **the run's only copy**, so
 * there is nothing to put it back: the run database is cloned from the template
 * at the start and dropped at the end.
 *
 * The measurement, on the failure this ledger was written for:
 * `test/integration/catalog/attributes-migration-parity.test.ts` walked
 * `down()` past its own target and timed out, and
 * `pnpm --filter backend exec vitest run test/integration/catalog` reported
 * **21 files red**. Excluding that one file: 20 of 20 green. The other twenty
 * failed on `relation "sales_channels" does not exist` and a failed harness
 * truncate — twenty messages, each pointing at itself, for one cause in the
 * file nobody would read last.
 *
 * ## The rule
 *
 * A file in this list takes a database of its own: `setupMigratorTestDb()`
 * clones the same migrated template the invocation was cloned from — a file
 * copy, a fraction of a second — and drops it in teardown. However badly the
 * migration sequence in that file goes, it goes there. It also means such a
 * file no longer has to leave the schema migrated for its neighbours, which is
 * the `afterAll` that was doing the damage.
 *
 * Under `BACKEND_TEST_ISOLATION=shared` there is no template to clone, so the
 * seam falls back to the shared database and says so. That is the escape
 * hatch's cost and it is declared, not accidental: the shared path is the
 * pre-#189 behaviour in full, including this.
 *
 * `test/unit/harness/migrator-driving-ledger.test.ts` keeps this list honest in
 * both directions, and checks that every entry is actually using the seam — an
 * entry is a description of what a file does, never a permission to keep doing
 * it on the shared database.
 */

export interface MigratorDrivingTest {
  /** Path relative to `backend/`, exactly as vitest reports it. */
  readonly path: string;
  /** What the file drives the migrator for. */
  readonly reason: string;
}

export const MIGRATOR_DRIVING_TESTS: readonly MigratorDrivingTest[] = [
  {
    path: 'test/integration/catalog/attributes-migration-parity.test.ts',
    reason:
      'Feature 061 SC-001 parity: reverts the attributes-on-custom-fields migration, seeds ' +
      'legacy-shaped rows through raw SQL, re-applies it and asserts the reshape — then ' +
      'reverts again to assert down() restores the legacy shape. The migration itself is ' +
      'the thing under test, so there is no double to drive instead.',
  },
];
