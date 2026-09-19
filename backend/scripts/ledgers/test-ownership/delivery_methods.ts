/**
 * Harness-free tests still under `backend/test` that name `delivery_methods` and no other
 * module (feature 106, `specs/106-module-owned-tests/`; contract §4).
 *
 * Keyed by the file's repository-relative path and never by a line — an entry keyed on a
 * line reds on any insertion above the site. Two-way: an unledgered file fails the build,
 * and an entry that no longer describes one fails it too, so the batch that moves a file
 * deletes its entry in the same merge request. Delete this file when the last entry goes;
 * an empty shard is refused, because a done signal that says nothing is not one.
 *
 * Every entry here is **scheduled**, not retained: the file is `delivery_methods`'s and the
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
 *
 * The third entry needs a reason of its own and has one below: it is not
 * harness-free in the sense the batch can act on.
 */
const SCHEDULED: TestOwnershipLedgerEntry = {
  scheduled: true,
  reason:
    'Harness-free and single-owner, so contract §1 places it in ' +
    '`packages/modules/delivery_methods`. It has not moved: feature 106 moved the files whose ' +
    'subjects had already been packaged and left this one behind.',
  retiredBy:
    'The batch that moves `delivery_methods`\'s harness-free tests beside their subjects — ' +
    'feature 106\'s residue, tracked as `specs/109-backend-test-kit/` Phase 5.',
};

export const entries: Readonly<Record<string, TestOwnershipLedgerEntry>> = {
  'backend/test/unit/delivery_methods/eligibility.test.ts': SCHEDULED,
  'backend/test/unit/delivery_methods/shipment-usage-guard.test.ts': SCHEDULED,
  /**
   * **It reads as harness-free and is not** (feature 134, W7).
   *
   * This check's predicate is `setupBackendServer`, and the file stopped calling it
   * when the published install surface gave it something to test transactionally:
   * the seam writes a `sales_channel_delivery_methods` row and deletes a
   * `delivery_methods` one, and both belong inside a transaction that is rolled
   * back rather than in the shared database. It calls `setupTestDb` instead, so it
   * needs a **real Postgres** and cannot run in a module package's `vitest run`,
   * which collects the `.test.ts` files under `src` with no database at all.
   *
   * So it is scheduled on a different batch from the two above: what moves it is
   * not "someone gets round to it" but a package-side harness that can open a
   * transaction — `specs/109-backend-test-kit/` Phase 5, which is also what W2 of
   * `specs/134-paid-module-extraction/contracts/extraction-procedure.md` waits on.
   */
  'backend/test/integration/delivery_methods/reconciler.test.ts': {
    scheduled: true,
    reason:
      'Single-owner — it judges `delivery_methods`\' `DeliveryMethodSeedApi` and names no other ' +
      'module — and harness-free only by this check\'s predicate: it needs a real Postgres ' +
      'through `setupTestDb`, which a module package cannot open today.',
    retiredBy:
      'The package-side transactional harness `specs/109-backend-test-kit/` Phase 5 publishes. ' +
      'Until a package can reach a database, moving this file would delete the assertions ' +
      'rather than relocate them.',
  },
};
