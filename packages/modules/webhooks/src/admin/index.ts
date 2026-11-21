/**
 * `webhooks`' admin surface — two routes and one sidebar entry, declared by the
 * module that owns them (feature 091, Phase 4, the plan's batch 6;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The batch this module belongs to was unblocked by P2 rather than chosen by
 * size.** `plan.md`'s sequence table records this module's drain as **1**, and
 * that one key was `WebhooksPage.tsx`'s reach into `admin/src/components/
 * organization-picker` — a Group A entry in
 * `backend/scripts/ledgers/admin-surface.ts`, retired when the picker became
 * `@endora-commerce/admin-kit/components`'. The screen names the published
 * component now, so this batch pays no reach of its own and its
 * `check:module-boundary` line is unchanged on both sides — which is the
 * measurement a zero-drain batch must produce, and which is only honest because
 * the reach was drained in a merge request of its own first.
 *
 * **The permission the screen is gated on is shared with `api_keys`.**
 * `integrations:manage` guards every route in both modules' admin surfaces and
 * both manifests declare it (issue #213), so the code stays grantable while
 * either surface is on. That is why this entry names the same code the API
 * enforces rather than a `webhooks:`-prefixed one that does not exist.
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
import { WEBHOOKS_NEW_PATH, WEBHOOKS_PATH } from './paths.js';

/** The list: the subscription registry and its delivery log. */
const ROUTE_PATH = WEBHOOKS_PATH;

/**
 * The code every route of this module's admin API enforces —
 * `requireAdmin('integrations:manage')` on `GET /api/v1/admin/webhooks` and on
 * each of its siblings. It is the same code the module's `open-webhooks`
 * palette action declares, which `check:action-route-permissions` holds to this
 * very route.
 */
const PERMISSION = 'integrations:manage';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/WebhooksPage.js'),
      requiredPermission: PERMISSION,
      index: true,
    },
    {
      // Subscribing (issue #1501, UX audit SHELL-14): the form that was drawn
      // open above the list, reached from its *New webhook*. Same gate — the
      // create route enforces the same code as the list.
      path: WEBHOOKS_NEW_PATH,
      component: () => import('./pages/WebhookCreatePage.js'),
      requiredPermission: PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/webhooks/i18n/`. It was `appShell.nav.webhooks` in
      // the shared `_i18n` bundle, one of the four shared files a module author
      // had to edit.
      labelKey: 'nav.webhooks.label',
      // The glyph `AppShell.tsx` rendered by hand. A nav entry names its icon,
      // so `Webhook` joins `KnownIconNameSchema` and the kit's `icon-map.ts` in
      // this merge request rather than the sidebar quietly changing to a name
      // that happened to be on the allowlist.
      icon: 'Webhook',
      section: 'platform',
      // Issue #1519 (UX audit SHELL-11, DEC-02) split *System*: *Platform* is
      // how the instance is configured and extended, ordered with the host's
      // own rows by weight — Modules 100, Settings 200, Custom fields 300,
      // Import/export 400, Bulk operations 500, Webhooks 600, Global search
      // 700, PWA 800, Command hooks 900, API description 1000. The first of the
      // integration rows.
      weight: 600,
      requiredPermission: PERMISSION,
    },
  ],
};
