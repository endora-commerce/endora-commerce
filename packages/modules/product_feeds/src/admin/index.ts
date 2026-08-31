/**
 * `product_feeds`' admin surface — ten routes and one sidebar entry, declared
 * by the module that owns them (feature 091, Phase 4, the plan's batch 7;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Ten routes and one nav row is the shape, not an omission.** Templates,
 * category mapping and taxonomy revisions are reached through the tab strip on
 * the feeds page — a second sidebar row for a sibling view is the duplication
 * `AppShell.catalog-feeds-nav.test.tsx` was written to keep out — and the run,
 * detail and editor screens are reached from a list. A nav entry is a landing
 * surface; nine of these ten are not.
 *
 * **This is the batch's only member that pays a reach.** `plan.md`'s sequence
 * table records this module's drain as **16**, of which 15 were kit keys P2 and
 * P3 have paid, leaving one client reach:
 * `ProductFeedCreatePage.tsx` imported `salesChannelsClient` from
 * `sales_channels`' admin client for two calls. The ledger's own retiring
 * condition names two exits and refuses a third, and this batch takes the
 * first — the caller builds both requests from the published `apiClient` and
 * the contract's own types, in `api.ts`' `feedSalesChannelReads`. The shard is
 * deleted rather than edited.
 *
 * **Route order is not declaration order.** `react-router` v7 ranks routes, so
 * `/product-feeds/new` and `/product-feeds/templates` outrank
 * `/product-feeds/:feedId` however they are written. `App.tsx`'s hand-written
 * block ordered them by hand with a comment saying a feed id would otherwise
 * swallow them; the comment described a rule the router already applies, and
 * this array is ordered for a reader instead.
 *
 * **Its sidebar position does not change.** `/product-feeds` was the last row
 * of *Catalog* and every other row there is still host-declared, so
 * `composeNav` appends this one after all of them — which is the position it
 * already had. The declared weight (1000, the hand-written position times a
 * hundred, batch four's convention) is what will keep it there once that
 * section's other rows convert.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer, and each component is a dynamic-import factory (R6) so Vite has a
 * split point whether or not anybody remembers to ask for one.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the feed list. */
const BASE = '/product-feeds';

/**
 * The code every one of these ten screens is opened by —
 * `deps.requireAdmin(PRODUCT_FEEDS_READ_PERMISSION)` across
 * `routes.admin.ts`, `routes.templates.ts`, `routes.taxonomies.ts` and
 * `routes.delivery.ts`. The write code gates generation, rotation, revocation
 * and **download** (FR-051: a generated file carries prices), which are
 * controls inside a screen rather than the screen itself.
 */
const PERMISSION = 'product_feeds:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: BASE,
      component: () => import('./pages/ProductFeedsListPage.js'),
      requiredPermission: PERMISSION,
      index: true,
    },
    {
      path: `${BASE}/new`,
      component: () => import('./pages/ProductFeedCreatePage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${BASE}/templates`,
      component: () => import('./pages/FeedTemplatesListPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${BASE}/templates/new`,
      component: () => import('./pages/FeedTemplateStartFromPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${BASE}/templates/import`,
      component: () => import('./pages/FeedTemplateImportPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${BASE}/templates/:templateId`,
      component: () => import('./pages/FeedTemplateEditorPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${BASE}/category-mapping`,
      component: () => import('./pages/CategoryMappingPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${BASE}/taxonomy-revisions`,
      component: () => import('./pages/TaxonomyRevisionsPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${BASE}/:feedId/runs/:runId`,
      component: () => import('./pages/FeedRunDetailPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${BASE}/:feedId`,
      component: () => import('./pages/ProductFeedDetailPage.js'),
      requiredPermission: PERMISSION,
    },
  ],
  nav: [
    {
      to: BASE,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/product_feeds/i18n/`. It was
      // `appShell.nav.productFeeds` in the shared `_i18n` bundle, one of the
      // four shared files a module author had to edit.
      labelKey: 'nav.productFeeds.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema` — this module's own palette action names it.
      icon: 'Rss',
      // A feed publishes the catalogue, so it belongs beside the catalogue
      // rather than under Channels — the placement
      // `AppShell.catalog-feeds-nav.test.tsx` asserts and this declaration
      // keeps.
      section: 'catalog',
      weight: 1000,
      requiredPermission: PERMISSION,
    },
  ],
};
