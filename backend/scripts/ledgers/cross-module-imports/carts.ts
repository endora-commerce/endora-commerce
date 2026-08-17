/**
 * Cross-module imports still standing in `carts` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */

/**
 * The `carts` cut retired twenty-four of the twenty-five. The one left is a
 * **write**, and it is escalated rather than deferred.
 *
 * `CartApprovalService.setPolicyByAdmin` and `setPolicyForOrganization` flip
 * `organizations.requires_cart_approval` — another module's column — and then
 * cascade a reset over this module's own `carts` rows, auditing each. Every
 * *read* of that row in the file went to `organizationDetailsPort` in this
 * merge request; the two writes could not, because `organizations` publishes no
 * write port for the policy and D-78 forbids guessing one:
 *
 *   - **D-78 step 1** — "can one module own the whole operation?" — is the
 *     right answer here, and it is a *design* answer rather than a mechanical
 *     one. `organizations` would publish `setCartApprovalPolicy(orgId, requires)`
 *     as its own `CommandBus.run`, and `carts` would call it and then run its
 *     own cascade. The two halves are already not atomic (the org write flushes
 *     before the cart loop starts), so nothing is lost — but it decides whether
 *     the policy flip gains an audit row on the `organizations` side, which it
 *     has never had, and that is a product question about who owns the trail.
 *   - **Inlining is refused** (plan.md trap 6): two modules writing one table is
 *     strictly worse than the import, and invisible to every check in the tree.
 *   - **Publishing the port from here is refused** by contracts/port-publication
 *     §2.1: an under-published provider is a P-MR, and `organizations` is its
 *     own Phase-C module (C-W4 #41) with its own reviewer.
 *
 * Retired by: `organizations` publishing a cart-approval-policy write port, or
 * the ruling that the policy column belongs to `carts` and should move. Either
 * is a decision about ownership, not a refactor.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/carts/services/cart-approval-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — carts, escalated. The two `setPolicy*` methods write ' +
    '`organizations.requires_cart_approval`, and `organizations` publishes no write port for ' +
    'it; D-78 rules the class and the answer is a P-MR on that module, not a cut here. Every ' +
    'read of the row in this file is `organizationDetailsPort` already. See the note above.',
};
