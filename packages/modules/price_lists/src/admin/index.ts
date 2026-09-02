/**
 * `price_lists`' admin surface — three zone contributions and nothing else
 * (feature 091, P7a and P7b;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10).
 *
 * **This module contributes no route and no sidebar entry here.** Its screens
 * are still under `admin/src/modules/price_lists/` and move in Phase 4's batch
 * 13; a module may declare a zone contribution while its screens are elsewhere,
 * because `check:admin-registrations` counts routes and nav entries and a zone
 * is neither.
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
 * The code that opens both contributed surfaces.
 *
 * `packages/modules/price_lists/src/backend/routes.ts` builds one `readGate`
 * from `PRICE_LIST_PERMISSIONS.READ` and gates both endpoints with it:
 * `GET /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` and
 * `GET /api/v1/admin/products/:productId/price-lists`. The write half of the
 * display-mode row is `price_lists:write`, which the row's `PUT` enforces and
 * which a contribution cannot declare a second time — the read code is what
 * makes the surface appear.
 */
const READ_PERMISSION = 'price_lists:read';

export const contributions: AdminContributions = {
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
