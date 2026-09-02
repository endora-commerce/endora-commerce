/**
 * `comparisons`' admin surface — two routes and one sidebar entry, declared by
 * the module that owns them (feature 091, Phase 4, the plan's batch 6;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The batch this module belongs to was unblocked by P2 rather than chosen by
 * size.** `plan.md`'s sequence table records this module's drain as **1**, and
 * that one key was `ComparisonsListPage.tsx`'s reach into
 * `admin/src/components/sales-channel-picker` — a Group A entry in
 * `backend/scripts/ledgers/admin-surface.ts`, retired when the picker became
 * `@endora-commerce/admin-kit/components`'. The screen names the published
 * component now, so this batch pays no reach of its own.
 *
 * **The detail route has no sidebar row and never will** — a nav entry is a
 * landing surface. `registryCrumbs` matches anything beneath a contributed
 * entry's `to`, so `/comparisons/:id` keeps a derived trail rather than falling
 * onto the humanised-segment fallback; it is two crumbs where the hand-written
 * `CRUMB_DICT` rule built three, which is the visible consequence this
 * conversion records rather than hides.
 *
 * **Both routes take the read code, and that is the whole of what this surface
 * enforces.** The admin side of this module is read-only —
 * `routes.admin.ts` mounts one list and one detail handler, each behind
 * `requireAdmin('comparisons:read')`, and there is no write route to gate.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 *
 * **Each component is a dynamic-import factory** (R6), so Vite has a split
 * point whether or not anybody remembers to ask for one.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the comparison overview. */
const ROUTE_PATH = '/comparisons';

/**
 * The code both routes of this module's admin API enforce —
 * `requireAdmin('comparisons:read')` on `GET /api/v1/admin/comparisons` and on
 * `GET /api/v1/admin/comparisons/:id`. It is the same code the module's
 * `open-comparisons` palette action declares, which
 * `check:action-route-permissions` holds to the landing route.
 */
const PERMISSION = 'comparisons:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/ComparisonsListPage.js'),
      requiredPermission: PERMISSION,
      index: true,
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/ComparisonDetailPage.js'),
      requiredPermission: PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/comparisons/i18n/`. It was `appShell.nav.comparisons`
      // in the shared `_i18n` bundle, one of the four shared files a module
      // author had to edit.
      labelKey: 'nav.comparisons.label',
      // The glyph `AppShell.tsx` rendered by hand. A nav entry names its icon,
      // so `Scale` joins `KnownIconNameSchema` and the kit's `icon-map.ts` in
      // this merge request rather than the sidebar quietly changing to a name
      // that happened to be on the allowlist.
      icon: 'Scale',
      section: 'customers',
      // The hand-written position in *Customers* times a hundred, which is
      // batch four's convention: `/comparisons` was the sixth and last row of
      // that section. Every other row there is still host-declared, so
      // `composeNav` appends this one after all of them — which is the position
      // it already had.
      weight: 600,
      requiredPermission: PERMISSION,
    },
  ],
};
