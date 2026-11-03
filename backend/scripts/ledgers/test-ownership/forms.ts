/**
 * Tests under `backend/test` that name `forms` and no other module and boot no
 * server (feature 106, `specs/106-module-owned-tests/`; contract §4).
 *
 * Keyed by the file's repository-relative path. Two-way: an unledgered file fails
 * the build, and an entry that no longer describes one fails it too.
 *
 * The one entry is **retained**: the file is right to stay under `backend/test`.
 */
import type { TestOwnershipLedgerEntry } from '../../check-test-ownership.js';

export const entries: Readonly<Record<string, TestOwnershipLedgerEntry>> = {
  'backend/test/integration/forms/migration.test.ts':
    'It reads the forms schema back from the catalogue and drives the init migration down and ' +
    'up against a database of its own (`setupMigratorTestDb`, `specs/170-forms-module/` T013), ' +
    'which clones the host run’s migrated template and opens it with the host’s ' +
    '`mikroOrmConfig()` — the generated entity and migration registries of this tree. A ' +
    'package test has neither the template nor the registries, so the file cannot move beside ' +
    'its subject.',
};
