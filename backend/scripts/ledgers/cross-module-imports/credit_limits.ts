/**
 * Cross-module imports still standing in `credit_limits` (feature 075, FR-022…FR-026).
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
export const entries: Readonly<Record<string, string>> = {
  'modules/credit_limits/backend.ts:organizations/services/organization-inheritance-service':
    'F3 Phase C — credit_limits. Retired by the credit_limits cut merge request.',
  'modules/credit_limits/routes.ts:organizations/entities/organization.entity':
    'F3 Phase C — credit_limits. Retired by the credit_limits cut merge request.',
  'modules/credit_limits/services/credit-limit-service.ts:organizations/services/organization-inheritance-service':
    'F3 Phase C — credit_limits. Retired by the credit_limits cut merge request.',
  'modules/credit_limits/services/credit-topup.ts:returns/ports/credit-topup.port':
    'F3 Phase C — credit_limits. Retired by the credit_limits cut merge request.',
};
