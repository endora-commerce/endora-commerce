/**
 * `seo`'s admin surface — one route and one sidebar entry, declared by the
 * module that owns them (feature 091, Phase 4, batch 8;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its one drain was `catalog`'s product picker**, which the screen renders to
 * choose the entity an SEO meta override applies to.
 * `backend/scripts/ledgers/cross-module-imports/seo.ts` recorded it with the
 * retiring condition this batch satisfies: the picker is generic — it renders a
 * chooser over data `catalog` holds and knows nothing about this consumer — so
 * it moved into `@endora-commerce/admin-kit` and the shard is deleted rather
 * than edited.
 *
 * **The permission is `catalog:write`, and it is not a mistake.** Every
 * `/api/v1/admin/seo/*` route enforces it; this module never declared a code of
 * its own, and the hand-written sidebar entry carried the same one. Giving it
 * one would be a product change bought to make a declaration read tidily, and
 * the off-state test drives the code the platform actually enforces.
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

/** The module's only route: sitemaps and metadata overrides. */
const ROUTE_PATH = '/seo';

/** The code every `/api/v1/admin/seo/*` route enforces. */
const SEO_PERMISSION = 'catalog:write';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/SeoPage.js'),
      requiredPermission: SEO_PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/seo/i18n/`. It was `appShell.nav.seo` in the shared
      // `_i18n` bundle, one of the four shared files a module author had to
      // edit.
      labelKey: 'nav.seo.label',
      // The glyph the hand-written NAV entry carried.
      icon: 'Search',
      section: 'channels',
      // The hand-written table put `/seo` last in *Channels*, after the two
      // dictionary rows. Every other row there is still the host's, so the
      // registry entry appends after all of them — which is the position this
      // one already had — and the weight orders it against the converted
      // entries that join the section later.
      weight: 400,
      requiredPermission: SEO_PERMISSION,
    },
  ],
};
