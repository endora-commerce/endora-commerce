/**
 * `orders`' admin surface — four routes, three sidebar entries and one zone
 * contribution (feature 091: P4d for the contribution, Phase 4 batch 15 for
 * the rest;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §6).
 *
 * **This entry said "no route and no sidebar entry here" until batch 15**, and
 * that sentence is what a module looks like halfway through the drain: P4d
 * declared the zone contribution while the screens were still `App.tsx`'s,
 * because `check:admin-registrations` counts routes and nav entries and a zone
 * is neither. The screens are here now, so the module is both ends of that
 * property at once — a contributor to `order.entry.tabs` and the host of four
 * other members.
 *
 * **The four it hosts.** `OrderDetail.tsx` mounts `order.detail.payment`,
 * `OrderShipmentsTab.tsx` mounts `order.shipment.row.actions` once per attempt
 * and `order.shipments.tab.actions` once per tab, and `OrderCreatePage.tsx`
 * mounts `order.entry.tabs` — through the kit's `<RouteTabsZone>` rather than a
 * bare `<AdminZone>`, because the strip counts what the hook already filtered
 * and *"fewer than two tabs is not a choice"*. P7d and P4d published all four,
 * and `payments`, `inpost` and `quick_order` contribute to them. A screen that
 * moved into this package and lost a mount would leave those contributions
 * rendering nowhere.
 *
 * **Zone and not a published component** for its own contribution, decided from
 * the file P4d deleted (§9.3): `OrderEntryTabs()` took no props at all and
 * answered the question *"which of these two modules is installed"* out of a
 * third party's file. There is no signature to publish — the component was
 * module knowledge, twice over — which is Z1 question 2 in its plainest form.
 *
 * **What it drains: nothing, and the zero is measured rather than assumed.**
 * Before anything moved on this branch, this module owned no
 * `backend/scripts/ledgers/cross-module-imports/` shard and was named as a
 * target by none: batch 5 paid the two carrier-client reaches
 * `OrderShipmentsTab.tsx` carried, and P7d retired the two `foreign-module-ids`
 * entries that same file had in favour of the two zones it now mounts.
 * `admin-surface.ts` is empty — P4d's own contribution drained one of its last
 * two keys. `check:module-boundary` reads
 * `cross-module reaches=7 (imports=3 sql=4) ledger-size=7 shards=4` on both
 * sides of the move, and that agreement is the measurement rather than a
 * silence.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/**
 * The code that opens the roster, the status configuration and one order.
 *
 * `packages/modules/orders/src/backend/routes.ts` gates
 * `GET /api/v1/admin/orders`, `GET /api/v1/admin/orders/statuses` and
 * `GET /api/v1/admin/orders/:id` with `requireAdmin('orders:read')`, and the
 * two hand-written sidebar rows with a read destination named it. That the
 * status screen is an *editor* and might therefore want the write code was
 * decided the other way in issue #232 and is recorded on the `order-statuses`
 * action in this module's manifest: a read-only operator can open it, so the
 * read code is the one that opens it.
 */
const READ_PERMISSION = 'orders:read';

/**
 * The code that opens the screen this module exists to create an order on, and
 * the tab that switches between the two ways of doing it.
 *
 * Read off the route, as §9.3 requires:
 * `packages/modules/orders/src/backend/routes.ts` gates
 * `POST /api/v1/admin/orders` — the one write `/orders/new` exists to make —
 * with `requireAdmin('orders:write')`, and `AppShell.tsx`'s own nav entry for
 * that path carried the same code.
 *
 * It is a **write** code on a tab, which is honest rather than a compromise:
 * the screen behind it exists only to create an order, and an operator who
 * cannot create one has no use for a switch between two ways of doing it. The
 * host component P4d replaced gated on module presence alone, so that was a
 * gate the conversion added.
 *
 * **The route tightens here for the same reason, and it is a repair.** The
 * `<Route path="/orders/new">` in `App.tsx` was ungated, so a read-only
 * operator followed an advertised sidebar row to a form whose save would
 * refuse. That is `credentials`' shape from batch 10 and `sales_channels`' from
 * batch 14: a screen whose only purpose is a write opens on the write code.
 */
const CREATE_PERMISSION = 'orders:write';

/** The module's landing route: the order roster. */
const ROUTE_PATH = '/orders';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/OrdersList.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // Declared before `/orders/:id`, and `App.tsx` declared it before it too.
      // `<Routes>` ranks by specificity rather than by declaration order, so
      // the static segment wins whatever the order; the ordering is kept
      // anyway, so a reader does not have to know that to see why the detail
      // route is safe here.
      path: `${ROUTE_PATH}/new`,
      component: () => import('./pages/OrderCreatePage.js'),
      requiredPermission: CREATE_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/statuses`,
      component: () => import('./pages/OrderStatusConfigPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/OrderDetail.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/orders/i18n/`. It was `appShell.nav.orders` in the
      // shared `_i18n` bundle, one of the four shared files a module author had
      // to edit.
      labelKey: 'nav.orders.label',
      // The glyph `AppShell.tsx` rendered by hand. It joins
      // `KnownIconNameSchema` and the kit's `icon-map.ts` in this merge request
      // rather than the entry silently degrading to a name that happens to be
      // on the allowlist already — `ShoppingCart`, which this module's own
      // `open-orders` action names, is a different glyph and the sidebar has
      // never rendered it.
      icon: 'ClipboardCheck',
      section: 'sales',
      // Batch four's convention: the hand-written table's position times a
      // hundred. These three were first, second and third of *Sales*' seven,
      // ahead of `quote_requests`' and `returns`' 400, `invoices`' 500 and
      // `ksef`'s 600 — which is the order an operator has today, the three host
      // rows sitting above the four contributed ones.
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: `${ROUTE_PATH}/new`,
      labelKey: 'nav.newOrder.label',
      icon: 'ClipboardCheck',
      section: 'sales',
      weight: 200,
      // The write code, matching the route beside it. Quick order is not a
      // second destination — it is the other way of getting lines into the same
      // order, so it lives behind the `order.entry.tabs` strip on this screen
      // rather than on a sidebar row of its own.
      requiredPermission: CREATE_PERMISSION,
    },
    {
      to: `${ROUTE_PATH}/statuses`,
      labelKey: 'nav.orderStatuses.label',
      icon: 'ClipboardCheck',
      section: 'sales',
      weight: 300,
      requiredPermission: READ_PERMISSION,
    },
  ],
  zones: [
    // Weight 100 of the two tabs in the order-entry strip: this one, then
    // `quick_order` at 200. That is the order the operator has seen since the
    // strip existed — standard first, because it is the entry mode that needs
    // no file — preserved rather than re-chosen.
    zoneComponent('order.entry.tabs', () => import('./zones/OrderEntryStandardTab.js'), {
      weight: 100,
      requiredPermission: CREATE_PERMISSION,
    }),
  ],
};
