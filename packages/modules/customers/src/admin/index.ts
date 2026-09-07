/**
 * `customers`' admin surface — three routes and two sidebar entries (feature
 * 091, Phase 4 batch 14).
 *
 * **This module is a zone *host*, and that is what puts it in batch 14 rather
 * than in 13.** `CustomerDetail.tsx` renders `customer.detail.after`, the
 * member P7b published for it, and `quick_order` contributes its default
 * preferences panel there. The publication is what freed this directory to
 * move: `check:admin-registrations` counts routes and nav entries and a zone is
 * neither, so a host may move whether or not its contributor has — the mirror
 * of the property batch 13's row rests on.
 *
 * **What it drains: nothing, and the zero is measured rather than assumed.**
 * Before anything moved on this branch, this module owned no
 * `backend/scripts/ledgers/cross-module-imports/` shard, was named as a target
 * by none, had no key in `admin-surface.ts` (which is empty) and none in
 * `foreign-module-ids.ts`. `check:module-boundary` reads
 * `cross-module reaches=7 ledger-size=7 shards=4` on both sides of the move,
 * and that agreement is the measurement rather than a silence.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * The one code that opens every screen below.
 *
 * `packages/modules/customers/src/backend/routes.admin.ts` gates the roster,
 * the presence view and one customer's detail with `customers:read`; the block,
 * unblock, impersonate, delete and restore controls each enforce
 * `customers:manage` on the API and gate themselves on the screen through
 * `useAuth().hasPermission`. The read code is what opens the screen, which is
 * issue #232's rule and the code both hand-written sidebar rows carried.
 */
const READ_PERMISSION = 'customers:read';

/** The module's landing route: the customer roster. */
const ROUTE_PATH = '/customers';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/CustomersList.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // Declared before `/customers/:id`, and `App.tsx` declared it before it
      // too. `<Routes>` ranks by specificity rather than by declaration order,
      // so the static segment wins whatever the order; the ordering is kept
      // anyway, so a reader does not have to know that to see why the detail
      // route is safe here.
      path: `${ROUTE_PATH}/online`,
      component: () => import('./pages/OnlineCustomers.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/CustomerDetail.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/customers/i18n/`. It was `appShell.nav.customers` in
      // the shared `_i18n` bundle, one of the four shared files a module author
      // had to edit.
      labelKey: 'nav.customers.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema` — this module's own palette actions name it.
      icon: 'Users',
      section: 'customers',
      // First and second in *Customers*, which is where the hand-written table
      // put them. `customer_accounts` and `credit_limits` declare 400 and
      // `comparisons` 600, so 100 and 200 keep the order an operator already
      // had; `/organizations` at 300 sits between them and those, exactly as it
      // did while all three were the host's.
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: `${ROUTE_PATH}/online`,
      labelKey: 'nav.customersOnline.label',
      icon: 'Users',
      section: 'customers',
      weight: 200,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
