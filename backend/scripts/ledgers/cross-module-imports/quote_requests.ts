/**
 * Cross-module imports still standing in `quote_requests` (feature 075, FR-022…FR-026).
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
  // The `quote_requests` cut retired nineteen of the twenty. This one is not a
  // read of another module's data and no port can express it: it is a **route
  // file** — `organizations/routes.sales-reps.ts`, which `organizations` owns
  // and this module *mounts*, through a dynamic `import()` inside its own
  // `register`. FR-015 names the remedy ("a contribution point the host owns"),
  // and the honest version of it here is simply that **`organizations` should
  // register its own routes from its own `backend.ts`** — the file already
  // lives there, is named after that module and reads that module's tables.
  //
  // It is escalated rather than done because the move is not behaviour-neutral
  // and the decision is not this module's to take. Today the four
  // `/api/v1/admin/organizations/:id/sales-reps` endpoints are inside
  // `quote_requests`' `ctx.routes`, so they are gated by **this** module's
  // effective state: switch quote requests off and sales-rep assignment
  // disappears with them. Registered by their owner they would be gated by
  // `organizations`, which is non-deactivatable — so the screen would never go
  // away. Both are defensible (they are permissioned `rfqs:handle`, which
  // argues for the first; they qualify an organisation, which is why
  // `organizations` owns the file and argues for the second) and picking one
  // changes an operator-visible surface.
  //
  // Retired by: the ruling on which module's activation hides the sales-rep
  // assignment screen, and the one-line move in `organizations/backend.ts` that
  // follows from it. Most naturally taken in the `organizations` cut (C-W4),
  // which touches that file anyway.
  'modules/quote_requests/plugin.ts:organizations/routes.sales-reps':
    'F3 Phase C — quote_requests, escalated. This module mounts a route file `organizations` ' +
    'owns; moving the registration to its owner changes which module\'s activation hides the ' +
    'screen. Retired by that ruling — see the note above.',
};
