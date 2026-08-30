/**
 * `analytics`' admin surface — one route and one sidebar entry, declared by the
 * module that owns them (feature 091, Phase 4;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * This is the **second batch** of the drain, and it was selected by the rule
 * `research.md` §6 sets — ascending incoming cross-module reach — with the
 * feasibility test batch one applied on top of it. `analytics` has **zero**
 * admin cross-module reach in either direction, and it is the only remaining
 * zero-incoming directory every one of whose host symbols
 * `@endora-commerce/admin-kit` publishes: the other candidates at that rung
 * reach either a Group A picker (`api_keys`, `comparisons`, `megamenu`, `blog`,
 * `webhooks`) or the Group B session cluster (`payment_methods`, `promotions`),
 * both of which `backend/scripts/ledgers/admin-surface.ts` records as
 * unpublished with a retiring condition that is somebody else's merge request.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 *
 * **The component is a dynamic-import factory** (R6), so Vite has a split point
 * whether or not anybody remembers to ask for one.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only route: the analytics dashboard. */
const ROUTE_PATH = '/analytics';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/AnalyticsPage.js'),
      // Read from the route this screen calls —
      // `requireAdmin('analytics:read')` on
      // `GET /api/v1/admin/analytics/summary` — and the same code the
      // module's `open-analytics` palette action declares, which
      // `check:action-route-permissions` holds to that route.
      requiredPermission: 'analytics:read',
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/analytics/i18n/`. It was `appShell.nav.analytics` in
      // the shared `_i18n` bundle, one of the four shared files a module author
      // had to edit.
      labelKey: 'nav.analytics.label',
      // The icon the hand-written NAV entry carried. `LineChart` joins
      // `KnownIconNameSchema` and `icon-map.ts` in this merge request so the
      // sidebar renders the same glyph it did before the move; swapping to a
      // name already on the allowlist would have been a visible change bought
      // for nothing.
      icon: 'LineChart',
      section: 'analyticsAds',
      // Below `google_analytics`' 200, which is the order the two had in the
      // hand-written NAV: `/analytics` first, `/google-analytics` second. A
      // module's entries still append to their section as a block until the
      // host's own entries carry weights, so the pair now sits after
      // `/linkedin-ads` and `/meta-ads` rather than before them — recorded in
      // `admin/test/components/AppShell.analytics-nav.test.tsx` rather than
      // left to be discovered.
      weight: 100,
      // The code that opens the screen, which is the only code this module's
      // admin surface enforces — the dashboard is read-only.
      requiredPermission: 'analytics:read',
    },
  ],
};
