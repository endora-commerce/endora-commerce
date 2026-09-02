/**
 * `inventory`'s admin surface — seven routes, five sidebar entries and one zone
 * contribution (feature 091, P7c for the zone, Phase 4 batch 13 for the
 * registrations;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10).
 *
 * **Two surface directories, one module**, which is the case AGENTS.md records
 * for `check:module-boundary` and the reason this is the batch's largest
 * conversion. `AppShell.tsx` attributes `/warehouses` to `module: 'inventory'`,
 * so `admin/src/modules/warehouses/` was this module's second surface directory
 * — the boundary ledger keyed P7c's panel `inventory/ChannelMembershipPanel`
 * for exactly that reason — and both directories are `src/admin/` now. The
 * warehouse client travelled with them, so the reach
 * `WarehousesList` makes into it is an intra-package relative import; leaving
 * it behind is what would have made a package name something under
 * `admin/src`, which is the failure `ChannelWarehouses` had to rebuild its way
 * out of.
 *
 * **The zone came first, and that is the property the batch rests on.** P7c
 * declared the contribution below while these screens were still
 * `admin/src/App.tsx`'s, because `check:admin-registrations` counts routes and
 * nav entries and a zone is neither — so a contributor can be scheduled
 * independently of the host that renders its place.
 *
 * **What it drains**: the single key in
 * `backend/scripts/ledgers/cross-module-imports/sales_channels.ts` —
 * `SalesChannelEditPage.tsx` importing `ChannelMembershipPanel` from
 * `admin/src/modules/warehouses/`. P7c deleted that shard and took this
 * module's admin reaches to zero, which is why batch 13 pays nothing: its one
 * remaining boundary key is a backend SQL reach and is feature 077's.
 *
 * **Zone and not a published component**, decided from the signature read off
 * the file in this merge request (§9.3): `(channelId)` — one identifier in,
 * nothing back, no `onChange` — which is Z1 question 2, an addition this module
 * makes because this module is installed.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/**
 * The code that opens the contributed surface.
 *
 * `packages/modules/inventory/src/backend/routes.admin.ts` gates
 * `GET /api/v1/admin/warehouses` and
 * `GET /api/v1/admin/sales-channels/:channelId/warehouses` with
 * `inventory:read`; the assign, promote and unassign behind the panel's
 * controls take `inventory:write`, which a contribution cannot declare a second
 * time and which the panel keeps asking for itself.
 */
const READ_PERMISSION = 'inventory:read';

/**
 * The code the CSV importer needs, and the only row of the five that differs.
 *
 * `AppShell.tsx` carried it on that row alone and this declaration keeps it:
 * the screen exists to write stock, so advertising it to a read-only operator
 * would be a promise the API refuses. The other four screens open on
 * {@link READ_PERMISSION} and gate their own controls on this code.
 */
const WRITE_PERMISSION = 'inventory:write';

/** The module's landing route: the stock roster. */
const ROUTE_PATH = '/inventory';

/**
 * The warehouse screens' route prefix.
 *
 * A second top-level path for one module, and it is the host table's: warehouses
 * are addressed as their own noun rather than as a subpath of stock, which is
 * what the sidebar has always said and what every deep link an operator holds
 * still spells.
 */
const WAREHOUSES_PATH = '/warehouses';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/InventoryPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      path: `${ROUTE_PATH}/low-stock`,
      component: () => import('./pages/LowStockPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/notifications`,
      component: () => import('./pages/AvailabilityNotificationsPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/import`,
      component: () => import('./pages/StockImportWizard.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: WAREHOUSES_PATH,
      component: () => import('./pages/WarehousesList.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      // Declared before `/warehouses/:id`, and `App.tsx` declared it before it
      // too. `<Routes>` ranks by specificity rather than by declaration order,
      // so the static segment wins whatever the order — the ordering is kept
      // anyway, so a reader does not have to know that to see why the editor
      // route is safe here.
      path: `${WAREHOUSES_PATH}/new`,
      component: () => import('./pages/WarehouseEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${WAREHOUSES_PATH}/:id`,
      component: () => import('./pages/WarehouseEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  // Five rows, in the order the hand-written table had them, at the hand-written
  // position times a hundred (batch four's convention). *Inventory* holds no
  // host-declared row once these leave and no other module contributes to it,
  // so these weights order the section outright.
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/inventory/i18n/`. All five were `appShell.nav.*` in
      // the shared `_i18n` bundle, one of the four shared files a module author
      // had to edit.
      labelKey: 'nav.stockOverview.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema` — this module's own `open-inventory` action names
      // `Boxes`, and the sidebar's is kept: this row is the sidebar's row.
      icon: 'Box',
      section: 'inventory',
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: WAREHOUSES_PATH,
      labelKey: 'nav.warehouses.label',
      // `Warehouse`, `TrendingDown`, `Bell` and `PackageOpen` join
      // `KnownIconNameSchema` and the kit's `icon-map.ts` in this merge request
      // rather than these four rows silently degrading to names that happen to
      // be on the allowlist already: `AppShell.tsx` imported all four from
      // `lucide-react` by hand, and a module declaration has to name its icon
      // rather than import it.
      icon: 'Warehouse',
      section: 'inventory',
      weight: 200,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: `${ROUTE_PATH}/low-stock`,
      labelKey: 'nav.lowStock.label',
      icon: 'TrendingDown',
      section: 'inventory',
      weight: 300,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: `${ROUTE_PATH}/notifications`,
      labelKey: 'nav.notifyWhenAvailable.label',
      icon: 'Bell',
      section: 'inventory',
      weight: 400,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: `${ROUTE_PATH}/import`,
      labelKey: 'nav.importStock.label',
      icon: 'PackageOpen',
      section: 'inventory',
      weight: 500,
      requiredPermission: WRITE_PERMISSION,
    },
  ],
  zones: [
    zoneComponent('sales_channel.editor.after', () => import('./zones/ChannelWarehouses.js'), {
      // The only contribution to this place, so the weight orders nothing
      // today. Declared rather than defaulted so a second contributor arrives
      // beside it rather than ahead of it by accident.
      weight: 100,
      // No `match`: `match` narrows the mounts of one place (Z13), and this
      // place has one host and one mount. Asserted absent in
      // `admin/test/modules/inventory/channel-warehouses-zone.test.tsx` so a
      // later author cannot add one quietly.
      requiredPermission: READ_PERMISSION,
    }),
  ],
};
