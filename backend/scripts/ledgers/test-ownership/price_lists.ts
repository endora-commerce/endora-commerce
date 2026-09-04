/**
 * Harness-free tests still under `backend/test` that name `price_lists` and no other
 * module (feature 106, `specs/106-module-owned-tests/`; contract §4).
 *
 * Keyed by the file's repository-relative path and never by a line — an entry keyed on a
 * line reds on any insertion above the site. Two-way: an unledgered file fails the build,
 * and an entry that no longer describes one fails it too, so the batch that moves a file
 * deletes its entry in the same merge request. Delete this file when the last entry goes;
 * an empty shard is refused, because a done signal that says nothing is not one.
 *
 * Every entry here is **scheduled**, not retained: the file is `price_lists`'s and the
 * only thing between it and its package is the batch that moves it. A retained entry — a
 * plain string — is the other claim, that the file is right to stay under
 * `backend/test`, and there is none in this shard.
 */
import type { TestOwnershipLedgerEntry } from '../../check-test-ownership.js';

/**
 * The batch that retires every entry below.
 *
 * One constant rather than 9 copies of one sentence: the files differ, the
 * reason does not, and a per-file paraphrase would be 9 chances to write a
 * different one.
 */
const SCHEDULED: TestOwnershipLedgerEntry = {
  scheduled: true,
  reason:
    'Harness-free and single-owner, so contract §1 places it in ' +
    '`packages/modules/price_lists`. It has not moved: feature 106 moved the files whose ' +
    'subjects had already been packaged and left this one behind.',
  retiredBy:
    'The batch that moves `price_lists`\'s harness-free tests beside their subjects — ' +
    'feature 106\'s residue, tracked as `specs/109-backend-test-kit/` Phase 5.',
};

export const entries: Readonly<Record<string, TestOwnershipLedgerEntry>> = {
  'backend/test/integration/customers/customer-group-pricing.test.ts': SCHEDULED,
  'backend/test/integration/kernel/decoration.test.ts': SCHEDULED,
  'backend/test/integration/price_lists/bracket-pricing-end-to-end.test.ts': SCHEDULED,
  'backend/test/integration/price_lists/listing-price-per-organization.test.ts': SCHEDULED,
  'backend/test/integration/price_lists/rule-builder-normalisation.test.ts': SCHEDULED,
  'backend/test/integration/price_lists/status-lifecycle.test.ts': SCHEDULED,
  'backend/test/integration/price_lists/status-sweeper-gating.test.ts': SCHEDULED,
  'backend/test/integration/price_lists/system-price-list-singleton.test.ts': SCHEDULED,
  'backend/test/unit/price_lists/price-list-status-worker.test.ts': SCHEDULED,
};
