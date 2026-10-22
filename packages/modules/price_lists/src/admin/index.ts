/**
 * `price_lists`' admin surface — one route, one sidebar entry and two zone
 * contributions (feature 091; `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10).
 *
 * **Feature 160 (D-287 P1) deleted the screens of the old model** — the
 * price-list roster, the list detail with its Application-rule builder, bracket
 * grid and price matrix, and the product editor's *Linked price lists* zone —
 * with the API they edited. The price-book editor that replaces them is P2
 * (`specs/161-price-book-editor/`), released together with this one, so no
 * release ships without a price editor. What is left is the display-mode
 * surface: the overrides page and the category and organization zones.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/**
 * The one code every surface below needs. The display-mode reads are gated on
 * `price_lists:read` by `packages/modules/price_lists/src/backend/routes.ts`;
 * setting a display mode enforces `price_lists:write` on the API, and the page
 * gates its own controls on that code through `useAuth().hasPermission`.
 */
const READ_PERMISSION = 'price_lists:read';

/** The module's landing route until P2's price-book editor: the display modes. */
const ROUTE_PATH = '/price-lists/display-modes';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/DisplayModeOverridesPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
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
  ],
};
