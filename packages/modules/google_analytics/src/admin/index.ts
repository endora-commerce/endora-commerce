/**
 * `google_analytics`' admin surface — three routes and one sidebar entry,
 * declared by the module that owns them (feature 091, Phase 4;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * This is the first batch of the drain. It was selected by the rule
 * `research.md` §6 sets — ascending incoming cross-module reach — and this
 * module has **none in either direction**: no admin file outside its own
 * directory reached into it, and its three files reached nothing but the host
 * design system, every symbol of which `@endora-commerce/admin-kit` publishes.
 * The reason that matters is not tidiness: a directory something reaches into
 * cannot move until the reach has an answer, and a directory that reaches out
 * cannot move until what it reaches is published — so the batches are ordered
 * by the reach and not by the size of the screen.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 *
 * **Every component is a dynamic-import factory** (R6). The editor is named
 * twice below — once for `/new` and once for `/:id` — and both are the same
 * factory value, so Vite emits one chunk for the screen rather than one per
 * route.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the custom-event list. */
const ROUTE_PATH = '/google-analytics';

/**
 * The create and edit screens are one component behind one factory.
 *
 * `react-router` matches `/google-analytics/new` against the parametric route
 * too, so the two declarations are deliberately separate — the editor reads
 * `id === 'new'` as its create mode, which is the behaviour the host route
 * table had when it declared both paths against one imported component.
 */
const editor = (): Promise<{ readonly default: unknown }> =>
  import('./pages/CustomEventEditPage.js');

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/CustomEventsListPage.js'),
      // Read from the route this screen calls
      // (`requireAdmin('google_analytics:read')` on
      // `GET /admin/google-analytics/custom-events`), not copied from a
      // neighbour — the rule `check:action-route-permissions` already holds
      // this module's `open-google-analytics` palette action to.
      requiredPermission: 'google_analytics:read',
      index: true,
    },
    {
      path: `${ROUTE_PATH}/new`,
      component: editor,
      // The create form posts to `POST /admin/google-analytics/custom-events`,
      // which enforces the write code — the same code the
      // `new-google-analytics-event` palette action declares for this path.
      requiredPermission: 'google_analytics:write',
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: editor,
      requiredPermission: 'google_analytics:write',
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/google_analytics/i18n/`. It was
      // `appShell.nav.googleAnalytics` in the shared `_i18n` bundle, one of the
      // four shared files a module author had to edit.
      labelKey: 'nav.googleAnalytics.label',
      // The icon the hand-written NAV entry carried.
      icon: 'Sparkles',
      section: 'analyticsAds',
      // The weight the hand-written NAV gave it by position: second of the four
      // entries in the Analytics & Ads group. It does not restore that position
      // yet — a module's entries append to their section until the host's own
      // entries carry weights, which is Story 3's to deliver as it drains them
      // — so the number records the intent rather than the current render.
      weight: 200,
      // The code that opens the screen. The sidebar advertises a destination,
      // so it gates on the read code the landing route enforces and not on the
      // write code its editor does.
      requiredPermission: 'google_analytics:read',
    },
  ],
};
