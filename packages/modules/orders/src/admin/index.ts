/**
 * `orders`' admin surface — one zone contribution and nothing else (feature
 * 091, P4d;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §6).
 *
 * **This module contributes no route and no sidebar entry here.** Its screens
 * are still under `admin/src/modules/orders/` and move in Phase 4's batch 15; a
 * module may declare a zone contribution while its screens are elsewhere,
 * because `check:admin-registrations` counts routes and nav entries and a zone
 * is neither.
 *
 * **What it drains**: one of the two remaining keys of
 * `backend/scripts/ledgers/admin-surface.ts` —
 * `admin/src/modules/orders/OrderCreatePage.tsx` importing `OrderEntryTabs` out
 * of `admin/src/components/`. `quick_order`'s contribution drains the other,
 * and with the pair gone that ledger is empty and its two-way ratchet is the
 * ordinary kind.
 *
 * **Zone and not a published component**, decided from the file this merge
 * request deletes (§9.3): `OrderEntryTabs()` took no props at all and answered
 * the question *"which of these two modules is installed"* out of a third
 * party's file. There is no signature to publish — the component was module
 * knowledge, twice over — which is Z1 question 2 in its plainest form: an
 * addition this module makes because this module is installed.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/**
 * The code that opens the screen this tab navigates to.
 *
 * Read off the route in this merge request, as §9.3 requires:
 * `packages/modules/orders/src/backend/routes.ts` gates
 * `POST /api/v1/admin/orders` — the one write `/orders/new` exists to make —
 * with `requireAdmin('orders:write')`, and `AppShell.tsx`'s own nav entry for
 * that path carries the same code.
 *
 * It is a **write** code on a tab, which is honest rather than a compromise:
 * the screen behind it exists only to create an order, and an operator who
 * cannot create one has no use for a switch between two ways of doing it. The
 * host component this replaces gated on module presence alone, so this is a
 * gate the conversion adds.
 */
const CREATE_PERMISSION = 'orders:write';

export const contributions: AdminContributions = {
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
