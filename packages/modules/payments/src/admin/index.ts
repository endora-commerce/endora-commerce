/**
 * `payments`' admin surface — one zone contribution and nothing else (feature
 * 091, P7d;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10).
 *
 * **This module contributes no route and no sidebar entry.** It has never had
 * one: its operator surface is a tab on `orders`' order detail, which is
 * exactly what made it an FR-007 case — there was no place for the owner to
 * contribute to, so the host named the owner instead. `order.detail.payment`
 * is that place.
 *
 * **What it retires**: the `visibility-gate` key
 * `admin/src/modules/orders/OrderDetail.tsx:visibility-gate:payments` in
 * `backend/scripts/ledgers/foreign-module-ids.ts`, whose recorded retiring
 * condition is this contribution. `orders` computed
 * `isVisible({ module: 'payments', requiredPermission: 'payments:read' })` for
 * the tab button and passed the same answer down to the body; it counts the
 * zone now (Z15) and knows only that it has a tab called Payment.
 *
 * **No `match`, and it is a decision rather than an omission.** `match`
 * narrows the *mounts of one place* (Z13), and this place has one host and one
 * mount, so there is nothing to narrow.
 * `admin/test/modules/payments/order-payments-zone.test.tsx` asserts it absent
 * so a later author cannot add one quietly.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/**
 * The code that opens the contributed tab, read off the route in this merge
 * request as §9.3 requires: `packages/modules/payments/src/backend/routes.ts`
 * gates `GET /api/v1/admin/orders/:id/payments` with
 * `requireAdmin('payments:read')`, which is also the code `orders`' own
 * `useSurfaceVisibility` call named. §10.6's line agrees, measured rather than
 * copied.
 *
 * **The panel calls a second route this code does not open**, and it is
 * recorded rather than repaired: its invoice list is
 * `GET /api/v1/admin/invoices?filter[orderId]=…`, gated `invoices:read` by
 * `packages/modules/invoices/src/backend/routes.admin.ts`. A contribution
 * declares one code, and an operator holding `payments:read` without
 * `invoices:read` sees the tab and an error inside it — which is the behaviour
 * the tab already had before the conversion, unchanged by it. Splitting the
 * invoice half into an `invoices` contribution of its own is a product change
 * and is outside P7d.
 */
const PAYMENTS_READ = 'payments:read';

export const contributions: AdminContributions = {
  zones: [
    // The only contribution to this member, so the weight orders nothing
    // today. Declared rather than defaulted so a second contributor arrives
    // beside it rather than ahead of it by accident.
    zoneComponent('order.detail.payment', () => import('./zones/OrderPaymentsTab.js'), {
      weight: 100,
      requiredPermission: PAYMENTS_READ,
    }),
  ],
};
