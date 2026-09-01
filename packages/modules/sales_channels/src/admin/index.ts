/**
 * `sales_channels`' admin surface — one zone contribution and nothing else
 * (feature 091, P7a;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10).
 *
 * **This module contributes no route and no sidebar entry here.** Its screens
 * are still under `admin/src/modules/sales_channels/` and move in Phase 4's
 * batch 14; a module may declare a zone contribution while its screens are
 * elsewhere, because `check:admin-registrations` counts routes and nav entries
 * and a zone is neither.
 *
 * **What it drains**: the third admin key in
 * `backend/scripts/ledgers/cross-module-imports/catalog.ts` —
 * `ProductEditor.tsx` importing `EntityChannelMembership` from this module's
 * admin directory and rendering it as the whole body of its Channels tab. The
 * host keeps the tab and its label, which is its own vocabulary (Z14), and
 * counts this contribution to decide whether to show the button (Z15).
 *
 * **Zone and not a published component**, decided from the signature read off
 * the file in this merge request (§9.3): `(entityType, entityId, onChanged?)` —
 * identifiers in, a change notification back and no `value`/`onChange` pair, so
 * the component owns its own persistence. That is Z1 question 2.
 *
 * `organizations`' detail screen mounts the same component today and is P7b's;
 * it will be a second contribution to a different member, never a `match` on
 * this one, because two hosts with a place each are two members (Z13).
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
 * `packages/modules/sales_channels/src/backend/routes.admin.ts` gates
 * `GET /api/v1/admin/sales-channels/by-entity/:entityType/:entityId` and
 * `GET /api/v1/admin/sales-channels` with `sales_channels:read`; the add and
 * remove behind the panel's two controls take `sales_channels:write`, which a
 * contribution cannot declare a second time. The read code is what makes the
 * surface appear, and it is the honest one: an operator holding it can see the
 * memberships even if the buttons then refuse.
 */
const READ_PERMISSION = 'sales_channels:read';

export const contributions: AdminContributions = {
  zones: [
    zoneComponent(
      'product.editor.channels',
      () => import('./zones/ProductChannelMembership.js'),
      {
        // The only contribution to this place, so the weight orders nothing
        // today. Declared rather than defaulted so a second contributor arrives
        // beside it rather than ahead of it by accident.
        weight: 100,
        requiredPermission: READ_PERMISSION,
      },
    ),
  ],
};
