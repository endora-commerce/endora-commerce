/**
 * `credit_limits`' admin surface — one route, one sidebar entry and, through
 * the manifest, one command-palette action (feature 091, Phase 4, batch 8;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its one drain was `dictionaries`' currency picker**, which the screen
 * renders to choose the currency a limit is denominated in.
 * `backend/scripts/ledgers/cross-module-imports/credit_limits.ts` recorded it;
 * the picker is generic, so it moved into `@endora-commerce/admin-kit` and the
 * shard is deleted rather than edited.
 *
 * **The baseline counted `nav: 2` and only one of them is a sidebar row.**
 * `adminNavEntries` reads any object literal carrying both `to` and `module`,
 * so `AppShell.tsx`'s `PALETTE_ITEMS` was in its population beside `NAV`. The
 * palette half is not a nav declaration and never was: it is a copy of the
 * advertisement the server was never asked about, which went on offering the
 * screen after an operator switched the module off. It arrives as a manifest
 * **action** instead — `open-credit-limits`, in `manifest.ts` — which is the
 * mechanism Principle XVI names and the one the effective enabled-set filters.
 *
 * **One permission code, not two.** Every `/api/v1/admin/credit-limits/*` route
 * enforces `credit_limits:manage`; this module never split read from write, so
 * the route requirement, the nav entry's, the palette action's and the API's
 * are one code.
 *
 * **This entry exports data and nothing else** (R2); the component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only route: limits, balances and active reservations. */
const ROUTE_PATH = '/credit-limits';

/** The code every `/api/v1/admin/credit-limits/*` route enforces. */
const CREDIT_LIMITS_PERMISSION = 'credit_limits:manage';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/CreditLimitsPage.js'),
      requiredPermission: CREDIT_LIMITS_PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), out of `packages/modules/credit_limits/i18n/`.
      labelKey: 'nav.creditLimits.label',
      icon: 'CreditCard',
      section: 'customers',
      // The hand-written table put `/credit-limits` fourth of five in
      // *Customers*, above `/comparisons`. `comparisons` converted in the
      // plan's batch 6 and declares weight 500, so this entry's 400 keeps the
      // two in the order an operator already had — and both still append after
      // the section's remaining host-declared rows, which is `composeNav`'s
      // behaviour until those convert too.
      weight: 400,
      requiredPermission: CREDIT_LIMITS_PERMISSION,
    },
  ],
};
