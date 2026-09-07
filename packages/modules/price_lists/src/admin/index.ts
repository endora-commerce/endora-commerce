/**
 * `price_lists`' admin surface — three routes, one sidebar entry and three zone
 * contributions (feature 091, P7a and P7b for the zones, Phase 4 batch 13 for
 * the registrations;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10).
 *
 * **The zones came first, and that is the property the batch rests on.** P7a
 * and P7b declared the three contributions below while this module's screens
 * were still `admin/src/App.tsx`'s, because `check:admin-registrations` counts
 * routes and nav entries and a zone is neither — so a contributor can be
 * scheduled independently of the host that renders its place. Batch 13 is the
 * other half: the three screens are this package's now.
 *
 * **What it drains**: two of the three admin keys in
 * `backend/scripts/ledgers/cross-module-imports/catalog.ts` —
 * `CategoriesTree.tsx` importing `DisplayModeOverrideRow` and
 * `ProductEditor.tsx` importing `LinkedPriceListsPanel` — and, with P7b, the
 * `DisplayModeOverrideRow` key of
 * `backend/scripts/ledgers/cross-module-imports/organizations.ts`. Each entry's
 * recorded retiring condition is *"the owner declaring an admin contribution
 * zone"*, and this is that declaration.
 *
 * **Zone and not a published component**, decided from the two signatures read
 * off the files in this merge request (§9.3): `(scope, targetId, …)` and
 * `(productId)` — identifiers in, nothing back, no `onChange` — which is Z1
 * question 2, an addition this module makes because this module is installed.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/**
 * The one code every surface below needs — the three screens and the three
 * contributions alike.
 *
 * `packages/modules/price_lists/src/backend/routes.ts` builds one `readGate`
 * from `PRICE_LIST_PERMISSIONS.READ` and gates every read with it: the price
 * list roster and one price list, plus the two endpoints behind the
 * contributions, `GET /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId`
 * and `GET /api/v1/admin/products/:productId/price-lists`. Saving a list,
 * writing a bracket and setting a display mode enforce `price_lists:write` on
 * the API, and each screen gates its own controls on that code through
 * `useAuth().hasPermission`; the read code is what opens the screen (issue
 * #232's rule, and the code the hand-written sidebar row carried).
 */
const READ_PERMISSION = 'price_lists:read';

/** The module's landing route: the price-list roster. */
const ROUTE_PATH = '/price-lists';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/PriceListsPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // Declared before `/price-lists/:id`, and `App.tsx` declared it before it
      // too. `<Routes>` ranks by specificity rather than by declaration order,
      // so the static segment wins whatever the order — the ordering is kept
      // anyway, so a reader does not have to know that to see why the detail
      // route is safe here.
      path: `${ROUTE_PATH}/display-modes`,
      component: () => import('./pages/DisplayModeOverridesPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/PriceListDetailPage.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  // One row for three screens, and the two without one are deliberate:
  // `/price-lists/:id` is a detail reached from the roster, and
  // `/price-lists/display-modes` is reached from the button the roster renders
  // beside its heading. A route is what `App.tsx` used to hold; a button is not
  // a route.
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/price_lists/i18n/`. It was `appShell.nav.priceLists`
      // in the shared `_i18n` bundle, one of the four shared files a module
      // author had to edit.
      labelKey: 'nav.priceLists.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema` — the palette action this batch declares names
      // the same one.
      icon: 'CircleDollarSign',
      section: 'pricing',
      // First in *Pricing*, which is where the hand-written table put it and
      // where the operator has always seen it. The section's other rows are
      // already the registry's — `taxes` and `promotions` at 200,
      // `delivery_methods` and `promotions`' second row at 300,
      // `payment_methods` at 600 — and the host declares none in it once this
      // one leaves, so 100 is the whole of what keeps this row on top.
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
  ],
  zones: [
    zoneComponent('category.editor.after', () => import('./zones/CategoryDisplayMode.js'), {
      // The only contribution to this place, so the weight orders nothing
      // today. Declared rather than defaulted so a second contributor arrives
      // beside it rather than ahead of it by accident.
      weight: 100,
      requiredPermission: READ_PERMISSION,
    }),
    zoneComponent(
      'product.editor.pricing.after',
      () => import('./zones/ProductLinkedPriceLists.js'),
      { weight: 200, requiredPermission: READ_PERMISSION },
    ),
    // Weight 200 of four contributors to the organization detail's zone
    // (feature 091, P7b): `sales_channels`' membership at 100, this row, then
    // `quick_order` at 300 and `carts` at 400. The order is the one the
    // operator saw when the three panels were scattered through
    // `OrganizationDetail.tsx`, preserved rather than re-chosen.
    zoneComponent(
      'organization.detail.after',
      () => import('./zones/OrganizationDisplayMode.js'),
      { weight: 200, requiredPermission: READ_PERMISSION },
    ),
  ],
};
