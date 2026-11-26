/**
 * Harness-free tests still under `backend/test` that name `admin_roles` and no other
 * module (feature 106, `specs/106-module-owned-tests/`; contract §4).
 *
 * Keyed by the file's repository-relative path and never by a line — an entry keyed on a
 * line reds on any insertion above the site. Two-way: an unledgered file fails the build,
 * and an entry that no longer describes one fails it too, so the batch that moves a file
 * deletes its entry in the same merge request. Delete this file when the last entry goes;
 * an empty shard is refused, because a done signal that says nothing is not one.
 *
 * Every entry but one is **scheduled**: the file is `admin_roles`'s and the only thing
 * between it and its package is the batch that moves it. A retained entry — a plain
 * string — is the other claim, that the file is right to stay under `backend/test`, and
 * the one below says why.
 */
import type { TestOwnershipLedgerEntry } from '../../check-test-ownership.js';

/**
 * The batch that retires every entry below.
 *
 * One constant rather than 6 copies of one sentence: the files differ, the
 * reason does not, and a per-file paraphrase would be 6 chances to write a
 * different one.
 */
const SCHEDULED: TestOwnershipLedgerEntry = {
  scheduled: true,
  reason:
    'Harness-free and single-owner, so contract §1 places it in ' +
    '`packages/modules/admin_roles`. It has not moved: feature 106 moved the files whose ' +
    'subjects had already been packaged and left this one behind.',
  retiredBy:
    'The batch that moves `admin_roles`\'s harness-free tests beside their subjects — ' +
    'feature 106\'s residue, tracked as `specs/109-backend-test-kit/` Phase 5.',
};

export const entries: Readonly<Record<string, TestOwnershipLedgerEntry>> = {
  'backend/test/contract/admin_users/permission-inventory.test.ts': SCHEDULED,
  'backend/test/unit/kernel/module-removal.test.ts': SCHEDULED,
  'backend/test/overlay/us2-permissions.test.ts': SCHEDULED,
  'backend/test/unit/admin_roles/foreign-gates.test.ts': SCHEDULED,
  'backend/test/unit/admin_roles/permission-dependencies.test.ts': SCHEDULED,
  'backend/test/unit/admin_roles/role-in-use-sentence.test.ts': SCHEDULED,
  'backend/test/unit/overlay/overlay-admin-populations.test.ts':
    "Retained: its subject is the example deployment's overlay populations, not this module's " +
    'analysis — it reads `backend/src/apps/example` through `test/helpers/permission-scan-roots.ts` ' +
    'and the `check:action-route-permissions` host (`specs/190-overlay-full-modules/` T047, #1855). ' +
    "`admin_roles`'s package has no deployment to read, so in it the proof would have no subject.",
};
