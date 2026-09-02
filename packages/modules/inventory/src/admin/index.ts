/**
 * `inventory`'s admin surface — one zone contribution and nothing else
 * (feature 091, P7c;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10).
 *
 * **This module contributes no route and no sidebar entry here.** Its screens
 * are still under `admin/src/modules/inventory/` and `admin/src/modules/warehouses/`
 * and move in Phase 4's batch 13; a module may declare a zone contribution
 * while its screens are elsewhere, because `check:admin-registrations` counts
 * routes and nav entries and a zone is neither.
 *
 * **What it drains**: the single key in
 * `backend/scripts/ledgers/cross-module-imports/sales_channels.ts` —
 * `SalesChannelEditPage.tsx` importing `ChannelMembershipPanel` from
 * `admin/src/modules/warehouses/`. That shard is deleted with this merge
 * request, and this module's admin reaches go to zero; its one remaining
 * boundary key is a backend SQL reach and is feature 077's.
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

export const contributions: AdminContributions = {
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
