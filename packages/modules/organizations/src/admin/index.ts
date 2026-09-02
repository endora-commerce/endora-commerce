/**
 * `organizations`' admin surface — two routes and one sidebar entry (feature
 * 091, Phase 4 batch 14).
 *
 * **This module is a zone *host*, and the busiest one in the feature.**
 * `OrganizationDetail.tsx` renders `organization.detail.after`, the member P7b
 * published for it, and **four** modules contribute there: `sales_channels`'
 * channel membership at 100, `price_lists`' display-mode override at 200,
 * `quick_order`'s ordering defaults at 300 and `carts`' approval policy at 400.
 * The publication is what freed this directory to move —
 * `check:admin-registrations` counts routes and nav entries and a zone is
 * neither, so a host may move whether or not its contributors have.
 *
 * **What it drains: nothing, and the zero is measured rather than assumed.**
 * Before anything moved on this branch, this module owned no
 * `backend/scripts/ledgers/cross-module-imports/` shard, was named as a target
 * by none, had no key in `admin-surface.ts` (which is empty) and none in
 * `foreign-module-ids.ts` — its one key there, `CartApprovalPolicyPanel.tsx`'s
 * `module-namespace:carts`, retired in P7b, which is what the four
 * contributions above cost that merge request instead of costing this one.
 * `check:module-boundary` reads `cross-module reaches=7 ledger-size=7 shards=4`
 * on both sides of the move, and that agreement is the measurement rather than
 * a silence.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * The codes that open the two screens, **any-of** because the route is any-of.
 *
 * `packages/modules/organizations/src/backend/routes.admin.ts:169` builds one
 * `requireAdminAny(['customers:read', 'customers:manage'])` gate and reads
 * every organization endpoint through it; the sixteen writes below it enforce
 * `customers:manage` alone. Naming only the read code — as the sidebar row did
 * until 2026-08-29 — hid the screen from a role holding just
 * `customers:manage`, which is why `AdminNavDeclaration.requiredPermission`
 * takes a `PermissionRequirement` and not a bare string.
 *
 * Both codes are this module's own declaration (`manifest.ts`, D-173), so an
 * operator switching `customers` off does not make them ungrantable while these
 * screens — owned by a module that cannot be switched off — go on answering.
 */
const READ_PERMISSION: readonly [string, string] = ['customers:read', 'customers:manage'];

/** The module's landing route: the organization roster. */
const ROUTE_PATH = '/organizations';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/OrganizationsList.js'),
      requiredPermission: [...READ_PERMISSION],
      index: true,
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/OrganizationDetail.js'),
      requiredPermission: [...READ_PERMISSION],
    },
  ],
  // One row for two screens, and the one without it is deliberate:
  // `/organizations/:id` is a detail reached from the roster. A route is what
  // `App.tsx` used to hold; a row in a table is not a route.
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/organizations/i18n/`. It was
      // `appShell.nav.organizations` in the shared `_i18n` bundle, one of the
      // four shared files a module author had to edit — and this module's
      // bundle held nothing but error sentences until now.
      labelKey: 'nav.organizations.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema` — the palette action this batch declares names
      // the same one.
      icon: 'Building2',
      section: 'customers',
      // Third in *Customers*, which is where the hand-written table put it:
      // after `customers`' two rows (100 and 200, declared in this same batch)
      // and before `customer_accounts`' and `credit_limits`' 400 and
      // `comparisons`' 600.
      weight: 300,
      requiredPermission: [...READ_PERMISSION],
    },
  ],
};
