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
 * One of those two is cut now; three entries stand.
 *
 * Two of them are one file, and neither is a missing port:
 * `routes.sales-reps.ts` is a route file `organizations` owns and
 * `quote_requests` **registers** (`quote_requests/plugin.ts` imports it
 * dynamically and builds its `deps` object), so this module has no seam through
 * which to hand the file a port its own container resolved. Both entries carry
 * the question that retires them.
 *
 * The third is the one raw-SQL reach still standing, and it is a missing port:
 * nothing in `packages/contracts/` publishes anything `credit_limits` owns.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/organizations/routes.sales-reps.ts:admin_users/entities/admin-user.entity':
    'F3 Phase C — organizations, deliberately left. The reads are `AdminUserReadPort.findById` ' +
    'and `.findByIds`, both published, but this route file is registered by `quote_requests` ' +
    'and receives its `deps` from that module, so `organizations` cannot inject a port into ' +
    'it. Retired by whichever comes first: the FR-015 split that gives `quote_requests` a ' +
    "contribution point for this file (that module's own shard already names the edge), or " +
    'moving the file to the module that registers it.',
  'modules/organizations/routes.sales-reps.ts:quote_requests/entities/quote-request.entity':
    'F3 Phase C — organizations, deliberately left. The read counts open Quote Requests per ' +
    "organisation — `quote_requests`' own fact, in a file `quote_requests` registers. " +
    'Resolving `quoteRequestReadPort` from `organizations` would also close a manifest cycle ' +
    '(`quote_requests` declares `organizations`) for a question this module does not own. ' +
    'Retired by the same FR-015 split as the entry above.',

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
