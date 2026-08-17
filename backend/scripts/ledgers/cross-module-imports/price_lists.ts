/**
 * Cross-module imports still standing in `price_lists` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * Twelve of this module's thirteen entries were retired by the Phase C cut. The
 * one left is not "not yet done" — it is a boundary the schema forbids closing
 * in this direction, stated below with the answer that retires it.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/price_lists/routes.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — the one edge in `price_lists` blocked by the schema rather than by a ' +
    'missing port. `customerAccountReadPort` exists and would serve the read (the admin ' +
    'resolved-price probe needs a customer’s `organizationId` and `customerGroupId`), but ' +
    'resolving it obliges `price_lists` to declare `customer_accounts`, and ' +
    '`customer_accounts.customer_group_id` is a foreign key into this module’s ' +
    '`customer_groups` — so `customer_accounts` already declares `price_lists`, and the ' +
    'reverse is a cycle `src/db/migration-order.ts` refuses outright. `nonBindingDependencies` ' +
    'does not fit either: the read must fail closed, because pricing for a customer the ' +
    'platform will not identify is worse than refusing the probe, and a `degrades-without` ' +
    'entry would have to be bought with a `catch` around the port call. Retired by: does the ' +
    'customer→group assignment move to a table `price_lists` owns (breaking the FK and with ' +
    'it the cycle), or does the migration-order graph learn to take a read-only edge that ' +
    'orders no schema?',
};
