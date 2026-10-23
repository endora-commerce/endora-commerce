/**
 * `price_lists`' admin surface — five routes, one sidebar entry and three zone
 * contributions (feature 091; `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10; feature 161, `specs/161-price-book-editor/research.md` R3).
 *
 * **Feature 160 (D-287 P1) deleted the screens of the old model** — the
 * price-list roster, the list detail with its Application-rule builder, bracket
 * grid and price matrix, and the product editor's *Linked price lists* zone —
 * with the API they edited, and left the display-mode page as the module's
 * temporary landing. **Feature 161 (P2) restores `/price-lists`** as the
 * landing — the price-book list — and adds the create flow, the explanation
 * screen and the book itself, with the product editor's base-price panel in the
 * zone the old panel left. The display-mode page stays at its address; Phase 9
 * makes it *Pricing settings*.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/**
 * The code every screen below opens on but the create flow. The price-book
 * reads are gated on `price_lists:read` by
 * `packages/modules/price_lists/src/backend/routes.price-books.ts` (and the
 * display-mode reads by `routes.ts`); every write enforces `price_lists:write`
 * on the API, and the screens gate their own controls on that code through
 * `useAuth().hasPermission` (FR-028: absent, not disabled).
 */
const READ_PERMISSION = 'price_lists:read';

/**
 * The code the create flow opens on — the `/new` shape of `blog` and
 * `sales_channels`: the palette's `new-price-book` advertises it under this
 * code, and a create form exists only to write.
 */
const WRITE_PERMISSION = 'price_lists:write';

/** The module's landing route: the price-book list. */
const ROUTE_PATH = '/price-lists';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/PriceBooksPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    // The static segments before `/:id`, as every module declares them;
    // `<Routes>` ranks by specificity, so the order is for the reader.
    {
      path: `${ROUTE_PATH}/new`,
      component: () => import('./pages/PriceBookCreatePage.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/explain`,
      component: () => import('./pages/PriceExplainerPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/display-modes`,
      component: () => import('./pages/DisplayModeOverridesPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      // The address P1's audit reference resolver links a book's audit rows to
      // (`backend/services/audit-references.ts`).
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/PriceBookPage.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/price_lists/i18n/`.
      labelKey: 'nav.priceLists.label',
      icon: 'CircleDollarSign',
      section: 'pricing',
      // First in *Pricing*; the section's other rows are the registry's.
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
    // Feature 161 (R7): the end of the product editor's Pricing tab, after the
    // PIM panels of `product.editor.pricing.before`. The only contributor to
    // this place; the weight is declared rather than defaulted for the category
    // member's reason.
    zoneComponent('product.editor.pricing.after', () => import('./zones/ProductBasePrices.js'), {
      weight: 100,
      requiredPermission: READ_PERMISSION,
    }),
  ],
};
