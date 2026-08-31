/**
 * `customer_accounts`' admin surface — one route and one sidebar entry,
 * declared by the module that owns them (feature 091, Phase 4, the plan's
 * batch 7;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The screen is customer *groups*, and the module that owns it is the one
 * that owns the account** — feature 076's D-79, unchanged by the move. The
 * route is `/customer-groups`, its API is `routes.admin.ts`' three handlers,
 * and the codes are this module's own `customer_groups:*` pair.
 *
 * **This module declares `activation.nonDeactivatable`**, which changes what
 * its off-state proof can drive and not whether it has one. A lock removes the
 * **operator's** ability to make `isPresent` answer `false`; it removes nothing
 * from the frontend's question, because the admin asks presence of every module
 * whatever its manifest says and the platform axis — a deployment that never
 * installs it — reaches the same gate. That is batch four's ruling
 * (`plan.md` Ruling 2) and `audit_logs` is the worked example.
 *
 * **Its sidebar position does not change.** Every other row in *Customers* is
 * still host-declared, so `composeNav` appends this one after all of them —
 * which is where the hand-written table already had it, fifth of six, above
 * `/credit-limits`. The declared weight (400, the hand-written position times a
 * hundred, batch four's convention) is what will restore the order once that
 * section's other rows convert; there is nothing to order it against today.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer, and each component is a dynamic-import factory (R6) so Vite has a
 * split point whether or not anybody remembers to ask for one.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only admin route: the customer-group list and editor. */
const ROUTE_PATH = '/customer-groups';

/**
 * The code the screen's entry route enforces —
 * `requireAdmin('customer_groups:read')` on
 * `GET /api/v1/admin/customer-groups` (`routes.admin.ts:37`). The two write
 * handlers beside it take `customer_groups:write`, which is what the screen's
 * own controls are gated on; the read code is what opens it, and it is the code
 * the module's `open-customer-groups` palette action already declares.
 */
const PERMISSION = 'customer_groups:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/CustomerGroupsPage.js'),
      requiredPermission: PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/customer_accounts/i18n/`. It was
      // `appShell.nav.customerGroups` in the shared `_i18n` bundle, one of the
      // four shared files a module author had to edit.
      labelKey: 'nav.customerGroups.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema` — this module's own palette action names it.
      icon: 'Users',
      section: 'customers',
      weight: 400,
      requiredPermission: PERMISSION,
    },
  ],
};
