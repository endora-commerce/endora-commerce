/**
 * Harness-free tests still under `backend/test` that name `transactional_emails` and no other
 * module (feature 106, `specs/106-module-owned-tests/`; contract §4).
 *
 * Keyed by the file's repository-relative path and never by a line — an entry keyed on a
 * line reds on any insertion above the site. Two-way: an unledgered file fails the build,
 * and an entry that no longer describes one fails it too, so the batch that moves a file
 * deletes its entry in the same merge request. Delete this file when the last entry goes;
 * an empty shard is refused, because a done signal that says nothing is not one.
 *
 * Every entry here is **scheduled**, not retained: the file is `transactional_emails`'s and the
 * only thing between it and its package is the batch that moves it. A retained entry — a
 * plain string — is the other claim, that the file is right to stay under
 * `backend/test`, and there is none in this shard.
 */
import type { TestOwnershipLedgerEntry } from '../../check-test-ownership.js';

/**
 * The batch that retires every entry below.
 *
 * One constant rather than 2 copies of one sentence: the files differ, the
 * reason does not, and a per-file paraphrase would be 2 chances to write a
 * different one.
 */
const SCHEDULED: TestOwnershipLedgerEntry = {
  scheduled: true,
  reason:
    'Harness-free and single-owner, so contract §1 places it in ' +
    '`packages/modules/transactional_emails`. It has not moved: feature 106 moved the files whose ' +
    'subjects had already been packaged and left this one behind.',
  retiredBy:
    'The batch that moves `transactional_emails`\'s harness-free tests beside their subjects — ' +
    'feature 106\'s residue, tracked as `specs/109-backend-test-kit/` Phase 5.',
};

export const entries: Readonly<Record<string, TestOwnershipLedgerEntry>> = {
  'backend/test/unit/transactional_emails/branding-scope.test.ts': SCHEDULED,
  'backend/test/unit/transactional_emails/send-no-transport.test.ts': SCHEDULED,
};
