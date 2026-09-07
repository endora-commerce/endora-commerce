/**
 * `quick_order`'s admin surface — one route, no sidebar entry and three zone
 * contributions (feature 091, P7b and P4d for the zones, Phase 4 batch 13 for
 * the route;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10).
 *
 * **No sidebar entry, and it is not an omission.** `AppShell.tsx`'s own
 * comment records why, in the *Sales* section this module never had a row in:
 * quick order *"is not a second destination — it is the other way of getting
 * lines into the same order, so it lives behind a tab on the order-entry page
 * rather than on its own sidebar row"*. That tab is the
 * `order.entry.tabs` contribution below, which P4d declared. So this module's
 * `{ routes: 1, nav: 0 }` entry leaves the ratchet like any other: a zero that
 * stays zero is a passing assertion, not a missing one, and `plan.md`'s Ruling
 * 1 puts the off-state proof on the **route**, which is what an operator
 * following a stale deep link meets.
 *
 * **The zones came first, and that is the property the batch rests on.** P7b
 * and P4d declared the three contributions below while this screen was still
 * `admin/src/App.tsx`'s, because `check:admin-registrations` counts routes and
 * nav entries and a zone is neither.
 *
 * **What it drains**: both `DefaultPreferencesPanel` keys of the boundary
 * ledger — the whole of
 * `backend/scripts/ledgers/cross-module-imports/customers.ts`, which is
 * deleted, and one of the three in `organizations.ts`. Each entry's recorded
 * retiring condition is *"the owner declaring an admin contribution zone"*, and
 * this is that declaration.
 *
 * **And, with P4d, one of the last two keys of
 * `backend/scripts/ledgers/admin-surface.ts`**:
 * `admin/src/modules/quick_order/QuickOrderOnBehalfPage.tsx` importing
 * `OrderEntryTabs` out of `admin/src/components/`. `orders` drains the other
 * with the twin tab, and with the pair gone that ledger is empty.
 *
 * **Zone and not a published component**, decided from the signature read off
 * the file in this merge request (§9.3): `({ scope, scopeId })` — two
 * identifiers in, nothing back, no `value`/`onChange` pair, and the panel owns
 * its own `PUT`. That is Z1 question 2, an addition this module makes because
 * this module is installed.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/**
 * The code that opens both contributed surfaces — and it is **not**
 * `quick_order:read`, which §10.6 named and which exists nowhere.
 *
 * Read off the routes in this merge request, as §10.6's own instruction for the
 * sibling row requires: `packages/modules/quick_order/src/backend/routes.preferences.admin.ts`
 * gates `GET` and `PUT /api/v1/admin/quick-order/preferences` with
 * `requireAdmin('orders:write')`, and every other admin route this module owns
 * takes the same code — the manifest's own palette action says so in place.
 * There is no `quick_order:*` permission in the platform at all, so declaring
 * one would not merely advertise a 403: no role could ever hold it, and the
 * panel would be invisible to every operator including the one who can use it.
 *
 * It is a **write** code for a surface that also reads, which is honest here
 * rather than a compromise: the panel is an editor, its `GET` is gated on the
 * same code as its `PUT`, and an operator holding `orders:write` can do both.
 */
const PREFERENCES_PERMISSION = 'orders:write';

/**
 * The module's only route: placing an order on a customer's behalf.
 *
 * It sits under `/orders/` rather than at a path of its own, which is the
 * placement the host table had and this declaration keeps: `orders` declares
 * `/orders`, `/orders/new`, `/orders/statuses` and `/orders/:id`, and
 * `<Routes>` ranks by specificity, so the static `quick-order` segment wins
 * over `orders`' parametric detail route whatever order the registry composes
 * them in.
 */
const ROUTE_PATH = '/orders/quick-order';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/QuickOrderOnBehalfPage.js'),
      // The same `orders:write` the zones declare, and for the same reason
      // read off the routes rather than guessed: the two `POST`s behind this
      // screen (`src/backend/routes.admin.ts`) carry it, and there is no
      // `quick_order:*` code in the platform at all.
      requiredPermission: PREFERENCES_PERMISSION,
      index: true,
    },
  ],
  zones: [
    // Weight 300 of four contributors to the organization detail's zone:
    // `sales_channels` at 100, `price_lists` at 200, this panel, then `carts`
    // at 400. That is the order the operator saw when the panels were
    // scattered through `OrganizationDetail.tsx`, preserved rather than
    // re-chosen.
    zoneComponent('organization.detail.after', () => import('./zones/OrganizationDefaults.js'), {
      weight: 300,
      requiredPermission: PREFERENCES_PERMISSION,
    }),
    // The only contribution to the customer detail's zone, so the weight
    // orders nothing today. Declared rather than defaulted so a second
    // contributor arrives beside it rather than ahead of it by accident.
    zoneComponent('customer.detail.after', () => import('./zones/CustomerDefaults.js'), {
      weight: 100,
      requiredPermission: PREFERENCES_PERMISSION,
    }),
    // Weight 200 of the two tabs in the order-entry strip: `orders`' standard
    // tab at 100, then this one. That is the order the operator has seen since
    // the strip existed, preserved rather than re-chosen.
    //
    // The same `orders:write`, and for the same reason one level down: the two
    // `POST`s behind `/orders/quick-order`
    // (`src/backend/routes.admin.ts`) carry it, and there is no
    // `quick_order:*` code in the platform at all.
    zoneComponent('order.entry.tabs', () => import('./zones/OrderEntryQuickTab.js'), {
      weight: 200,
      requiredPermission: PREFERENCES_PERMISSION,
    }),
  ],
};
