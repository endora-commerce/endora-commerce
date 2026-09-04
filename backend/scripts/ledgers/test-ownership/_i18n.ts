/**
 * Harness-free tests still under `backend/test` that name `_i18n` and no other
 * module (feature 106, `specs/106-module-owned-tests/`; contract §4).
 *
 * Keyed by the file's repository-relative path and never by a line — an entry keyed on a
 * line reds on any insertion above the site. Two-way: an unledgered file fails the build,
 * and an entry that no longer describes one fails it too, so the batch that moves a file
 * deletes its entry in the same merge request. Delete this file when the last entry goes;
 * an empty shard is refused, because a done signal that says nothing is not one.
 *
 * Every entry here is **scheduled**, not retained: the file is `_i18n`'s and the
 * only thing between it and its package is the batch that moves it. A retained entry — a
 * plain string — is the other claim, that the file is right to stay under
 * `backend/test`, and there is none in this shard.
 */
import type { TestOwnershipLedgerEntry } from '../../check-test-ownership.js';

/**
 * The batch that retires every entry below.
 *
 * One constant rather than 12 copies of one sentence: the files differ, the
 * reason does not, and a per-file paraphrase would be 12 chances to write a
 * different one.
 */
const SCHEDULED: TestOwnershipLedgerEntry = {
  scheduled: true,
  reason:
    'Harness-free and single-owner, so contract §1 places it in ' +
    '`packages/modules/_i18n`. It has not moved: feature 106 moved the files whose ' +
    'subjects had already been packaged and left this one behind.',
  retiredBy:
    'The batch that moves `_i18n`\'s harness-free tests beside their subjects — ' +
    'feature 106\'s residue, tracked as `specs/109-backend-test-kit/` Phase 5.',
};

export const entries: Readonly<Record<string, TestOwnershipLedgerEntry>> = {
  'backend/test/integration/_i18n/install-uninstall-bundles.integration.test.ts': SCHEDULED,
  'backend/test/integration/_i18n/translate-end-to-end.integration.test.ts': SCHEDULED,
  'backend/test/unit/_i18n/admin-routes-preference-port.test.ts': SCHEDULED,
  'backend/test/unit/_i18n/bundle-loader.unit.test.ts': SCHEDULED,
  'backend/test/unit/_i18n/error-code-collision.test.ts': SCHEDULED,
  'backend/test/unit/_i18n/error-code-routing-equality.test.ts': SCHEDULED,
  'backend/test/unit/_i18n/i18n-service.unit.test.ts': SCHEDULED,
  'backend/test/unit/_i18n/missing-key-logger.unit.test.ts': SCHEDULED,
  'backend/test/unit/_i18n/package-bundle-reconcile.test.ts': SCHEDULED,
  'backend/test/unit/_i18n/reconcile-timing.test.ts': SCHEDULED,
  'backend/test/unit/_i18n/registered-bundles-shape.test.ts': SCHEDULED,
  'backend/test/unit/scripts/check-inventory.test.ts': SCHEDULED,
};
