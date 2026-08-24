/**
 * Cross-module imports still standing in `organizations` (feature 075, FR-022…FR-026).
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
 *
 * **Thirty-nine of this module's forty-one sites were cut by the `organizations`
 * Phase-C merge request**, and the D-87 sweep added two raw-SQL reaches on top.
 * One of those two was cut then; D-166 has now cut the two that were one file.
 * One entry stands.
 *
 * The two that went were `routes.sales-reps.ts`, a route file this module owned
 * and `quote_requests` **registered** — so this module had no seam through which
 * to hand the file a port its own container resolved, and the file counted open
 * Quote Requests, which is not this module's fact. D-166 split the file by
 * owner: the three endpoints that qualify an organisation are registered here,
 * under a code this manifest declares, and read admins through
 * `adminUserReadPort`; the one that reads a `QuoteRequest` moved to
 * `quote_requests/routes.sales-reps.ts`. Neither entry has anything left to
 * describe.
 *
 * The one that stands is the raw-SQL reach, and it is a missing port: nothing in
 * `packages/contracts/` publishes anything `credit_limits` owns.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  // --- D-87: raw SQL against another module's tables (feature 077) ---
  'modules/organizations/services/organization-inheritance-service.ts:sql:credit_limits/credit_limits':
    'D-87 seed — `creditOwner` asks which organisations in an ancestor chain hold a ' +
    'credit limit, in one `select "organization_id" from "credit_limits" where ' +
    '"organization_id" in (…)`. The statement names no import specifier, so the boundary ' +
    'it crosses compiles and returns rows. **`creditLimitService` does not retire it**, ' +
    'which the seed reason assumed: that port\'s own `creditOwner` delegates back to this ' +
    'very method, so resolving it here is the question asking itself. The read also has ' +
    'to cross organisations on purpose — the `CreditLimit` entity is `@OrgScoped` and the ' +
    'owner is ' +
    'by definition an ancestor outside the caller\'s scope — so whatever replaces it ' +
    'answers under `withSystemScope`, not under the caller\'s filter. Retired by: a ' +
    'membership read on `credit_limits`\' published surface, taking the chain and ' +
    'answering which of those ids hold a row. `credit_limits` publishes no contract type ' +
    'at all today, so that port is that module\'s to write first.',
};
