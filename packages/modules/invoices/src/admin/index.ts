/**
 * `invoices`' admin surface — four routes and one sidebar entry, declared by
 * the module that owns them (feature 091, Phase 4, batch 12;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **This module is a zone *host* as well as a contributor of screens**, which
 * makes it the batch's real content. `InvoiceDetail` used to import
 * `InvoiceKsefPanel` from `@/modules/ksef/components/` — the single key in
 * `backend/scripts/ledgers/cross-module-imports/invoices.ts` — and that entry
 * says in its own words that neither moving the file nor rewriting the
 * specifier as `ksef`'s package subpath retires it, because both leave the same
 * coupling under a supported name. What retires it is this module publishing a
 * **place**: `<AdminZone name="invoice.detail.after" …>` in
 * `pages/InvoiceDetail.tsx`, with `ksef` declaring the contribution. The member,
 * the host render and the contribution land in this one merge request, because
 * `check:admin-zones` refuses a member no host renders and there is no
 * intermediate state that is green.
 *
 * **The templates screens keep no sidebar row**, which is not an omission: the
 * host table's own comment records that a template is reached through
 * `InvoiceSectionTabs` — the strip this module already owns since P4c — rather
 * than from the sidebar. Both template routes are declared here all the same,
 * because a route is what `App.tsx` used to hold and a tab is not a route.
 *
 * **Both palette actions were already declared** (`open-invoices`,
 * `invoice-templates`) and are untouched; this module had no hand-written
 * `PALETTE_ITEMS` row for the batch to delete.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the issued-invoice list. */
const ROUTE_PATH = '/invoices';

const TEMPLATES_ROUTE = `${ROUTE_PATH}/templates`;

/**
 * The one code every screen below needs to open.
 *
 * Read from the routes the four screens call on mount — the invoice list, one
 * invoice, the template list and one template are all
 * `requireAdmin('invoices:read')` in
 * `packages/modules/invoices/src/backend/routes.admin.ts`. Issuing, correcting,
 * sending and saving a template enforce `invoices:write` on the API, and each
 * screen gates its own controls on that code through
 * `useAuth().hasPermission`; the read code is what opens the screen (issue
 * #232's rule, and the code the hand-written sidebar row carried).
 */
const READ_PERMISSION = 'invoices:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/InvoicesList.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      path: TEMPLATES_ROUTE,
      component: () => import('./pages/InvoiceTemplatesPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${TEMPLATES_ROUTE}/:id`,
      component: () => import('./pages/InvoiceTemplateEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      // Declared last, and `App.tsx` declared it last too: `/invoices/:id`
      // matches `/invoices/templates` as well. `<Routes>` ranks by specificity
      // rather than by declaration order, so the static segment wins whatever
      // the order — the ordering is kept anyway, so a reader does not have to
      // know that to see why the detail route is safe here.
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/InvoiceDetail.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/invoices/i18n/`. It was `appShell.nav.invoices` in
      // the shared `_i18n` bundle, one of the four shared files a module author
      // had to edit.
      labelKey: 'nav.invoices.label',
      // The glyph `AppShell.tsx` rendered by hand (`Receipt`), and the one
      // this module's `open-invoices` action already names is `FileText`. The
      // sidebar's is kept: this row is the sidebar's row.
      icon: 'Receipt',
      section: 'sales',
      // The hand-written position times a hundred (batch four's convention).
      // *Sales* keeps its three `orders` rows, so a registry entry appends
      // after them and these weights order the three module rows this batch
      // contributes among themselves: `quote_requests` 400, this one 500,
      // `ksef` 600 — the order the hand-written table had.
      weight: 500,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
