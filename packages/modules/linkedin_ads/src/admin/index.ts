/**
 * `linkedin_ads`' admin surface — three routes and one sidebar entry, declared
 * by the module that owns them (feature 091, Phase 4;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **This is the third batch of the drain, and it is the first that pays a
 * boundary debt rather than finding none.** Batches one and two took modules
 * with zero admin cross-module reach in either direction, and !1176 recorded
 * that rung as exhausted. Re-measured, that reading enumerated the directories
 * with zero reach in *both* directions: eighteen more have zero **incoming**
 * reach and one or more outgoing, and `linkedin_ads` and `meta_ads` are the
 * pair at the top of that set whose every host symbol
 * `@endora-commerce/admin-kit` publishes. Their four outgoing reaches all land
 * on one target — `sales_channels`' admin client — and are retired here by the
 * exit `backend/scripts/ledgers/cross-module-imports/linkedin_ads.ts` names,
 * which is the caller building the request from the published `apiClient` and
 * the contract's own types. The shard is deleted with them.
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

/** The module's landing route: the conversion-mapping list. */
const ROUTE_PATH = '/linkedin-ads';

/**
 * The create and edit screens are one component behind one factory.
 *
 * `react-router` matches `/linkedin-ads/new` against the parametric route too,
 * so the two declarations are deliberately separate — the editor reads
 * `id === 'new'` as its create mode, which is the behaviour the host route
 * table had when it declared both paths against one imported component.
 */
const editor = (): Promise<{ readonly default: unknown }> =>
  import('./pages/ConversionMappingEditPage.js');

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/ConversionMappingsListPage.js'),
      // Read from the route this screen calls —
      // `requireAdmin('linkedin_ads:read')` on
      // `GET /admin/linkedin-ads/conversion-mappings` — and the same code the
      // module's `open-linkedin-ads` palette action declares, which
      // `check:action-route-permissions` holds to that route.
      requiredPermission: 'linkedin_ads:read',
      index: true,
    },
    {
      path: `${ROUTE_PATH}/new`,
      component: editor,
      // The create form posts to `POST /admin/linkedin-ads/conversion-mappings`,
      // which enforces the write code — the same code the
      // `new-linkedin-conversion-mapping` palette action declares for this path.
      requiredPermission: 'linkedin_ads:write',
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: editor,
      requiredPermission: 'linkedin_ads:write',
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/linkedin_ads/i18n/`. It was `appShell.nav.linkedinAds`
      // in the shared `_i18n` bundle, one of the four shared files a module
      // author had to edit.
      labelKey: 'nav.linkedInAds.label',
      // The icon the hand-written NAV entry carried.
      icon: 'Sparkles',
      section: 'analyticsAds',
      // Third of the four entries the hand-written NAV gave this section, after
      // `analytics` (100) and `google_analytics` (200). With `meta_ads` landing
      // in this same merge request the section holds no host-declared entry at
      // all, so these weights are the whole of its order — and the order they
      // produce is the one the hand-written table had, which is batch one's and
      // batch two's recorded regression retired rather than merely noted.
      weight: 300,
      // The code that opens the screen. The sidebar advertises a destination,
      // so it gates on the read code the landing route enforces and not on the
      // write code its editor does.
      requiredPermission: 'linkedin_ads:read',
    },
  ],
};
