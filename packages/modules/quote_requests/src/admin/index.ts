/**
 * `quote_requests`' admin surface — three routes and one sidebar entry,
 * declared by the module that owns them (feature 091, Phase 4, batch 12;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its drain is zero, re-derived on this branch before anything moved.** No
 * shard in `backend/scripts/ledgers/cross-module-imports/`, no key in
 * `admin-surface.ts`, none in `foreign-module-ids.ts`, and nothing outside
 * `App.tsx` reached into the directory. The plan recorded its remaining debt as
 * one `Section` reach into `orders`' admin directory, and P8 did not repair it —
 * it made it stop existing: `Section` is `@endora-commerce/admin-kit/ui`'s now,
 * so the reach is a bare specifier into a published `exports` map.
 *
 * **The hand-written `PALETTE_ITEMS` row is deleted and nothing replaces it**,
 * because the manifest already declares `open-rfq-inbox` with the same
 * destination, the same code and the same keywords. A hand-written palette row
 * is a copy the server was never asked about — for a module an operator really
 * can withdraw, it goes on advertising the screen after the withdrawal — and
 * this one was a duplicate of a declaration that has been there all along.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the quote desk. */
const ROUTE_PATH = '/quote-requests';

/**
 * The one code this module's admin API has.
 *
 * `packages/modules/quote_requests/src/backend/routes.admin.ts` builds a single
 * `requireAdmin('rfqs:handle')` guard and gates every admin route with it,
 * reads and writes alike, and `routes.sales-reps.ts` does the same — so the
 * create screen carries the same code as the list rather than a `:write` twin
 * that does not exist. It is the code the hand-written sidebar row and the
 * hand-written palette row both carried, and the one `open-rfq-inbox`
 * declares.
 */
const HANDLE_PERMISSION = 'rfqs:handle';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/RfqList.js'),
      requiredPermission: HANDLE_PERMISSION,
      index: true,
    },
    {
      path: `${ROUTE_PATH}/new`,
      component: () => import('./pages/RfqCreatePage.js'),
      requiredPermission: HANDLE_PERMISSION,
    },
    {
      // Declared after `/new`, as `App.tsx` declared it: `/quote-requests/:id`
      // matches `/quote-requests/new` too. `<Routes>` ranks by specificity, so
      // the static segment wins whatever the order; the ordering is kept so a
      // reader does not have to know that.
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/RfqDetail.js'),
      requiredPermission: HANDLE_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), out of this module's own `i18n/` bundle. It was
      // `appShell.nav.quoteRequests` in the shared `_i18n` one.
      labelKey: 'nav.quoteRequests.label',
      // The glyph `AppShell.tsx` rendered by hand, and the one `open-rfq-inbox`
      // names is `Inbox`. The sidebar's is kept: this row is the sidebar's row.
      icon: 'FileText',
      section: 'sales',
      // First of the three module rows this batch contributes to *Sales* —
      // `invoices` 500, `ksef` 600 — which is the order the hand-written table
      // had.
      weight: 400,
      requiredPermission: HANDLE_PERMISSION,
    },
  ],
};
