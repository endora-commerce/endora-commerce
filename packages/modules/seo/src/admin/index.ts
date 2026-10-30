/**
 * `seo`'s admin surface — one route, one sidebar entry and three contributions
 * beside its own settings on the Settings screen, declared by the module that
 * owns them (feature 091, Phase 4, batch 8;
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
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only route: sitemaps and metadata overrides. */
const ROUTE_PATH = '/seo';

/** The code every `/api/v1/admin/seo/*` route of the module's own screen enforces. */
const SEO_PERMISSION = 'catalog:write';

/**
 * The code that shows somebody the Settings screen, and the one the preview
 * endpoint enforces: whoever may see a setting may see what it amounts to,
 * including an administrator who may not change it
 * (`specs/144-seo-search-engine-robots/spec.md`, FR-045).
 */
const SETTINGS_READ_PERMISSION = 'settings:read';

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
  // What this module shows beside the settings it declared, on the Settings
  // screen `settings` owns. Each is narrowed with `match` to one setting code,
  // so its chunk is fetched only by a browser that is showing that row — and
  // all of them vanish with the module, through the zone renderer's presence filter.
  zones: [
    // The `robots.txt` the selected sales channel's storefront serves: the
    // rules it generates and the text in the field, saved or not.
    zoneComponent('settings.setting.after', () => import('./zones/RobotsTxtPreview.js'), {
      match: { settingCode: 'seo.robots_txt_custom' },
      requiredPermission: SETTINGS_READ_PERMISSION,
    }),
    // The `llms.txt` of the selected sales channel, drawn by the same
    // component — or the sentence that none is served there (FR-044).
    zoneComponent('settings.setting.after', () => import('./zones/LlmsTxtPreview.js'), {
      match: { settingCode: 'seo.llms_txt_additional' },
      requiredPermission: SETTINGS_READ_PERMISSION,
    }),
    // "This storefront does not apply the setting yet", on the row where an
    // operator would otherwise believe a shop is kept out of search (R9).
    zoneComponent(
      'settings.setting.after',
      () => import('./zones/DefaultRobotsStorefrontNotice.js'),
      {
        match: { settingCode: 'seo.default_robots' },
        requiredPermission: SETTINGS_READ_PERMISSION,
      },
    ),
    // Feature 163 (owner decision "SEO stub = A") — the product editor's SEO tab links
    // to this module's meta editor. `catalog` hosts the place and never names `seo`;
    // the code is the SEO screen's own, so the link never leads to a page it refuses.
    // 168-shim: the link moves to the new `product.editor.seo` zone until T125 replaces it with
    // `ProductSeoSection`.
    zoneComponent('product.editor.seo', () => import('./zones/ProductSeoLink.js'), {
      requiredPermission: SEO_PERMISSION,
    }),
  ],
};
