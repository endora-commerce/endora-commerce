/**
 * `meta_ads`' admin surface — three routes and one sidebar entry, declared by
 * the module that owns them (feature 091, Phase 4;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The twin of `linkedin_ads`, and the pair is deliberate.** Both carry zero
 * incoming admin cross-module reach, both reach `sales_channels`' admin client
 * twice and nothing else, and both take the exit their ledger shard names — the
 * caller building the request from the published `apiClient` and the contract's
 * own types. Taking one and not the other would have left the two remaining
 * host-declared entries of the *Analytics & Ads* section at one, which is the
 * state that makes the section's order half a weight and half a position; both
 * gone, the weights are the whole order and the order is the one the
 * hand-written table had. `linkedin_ads`' own `src/admin/index.ts` records the
 * measurement that chose them.
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

/** The module's landing route: the custom-event mapping list. */
const ROUTE_PATH = '/meta-ads';

/**
 * The create and edit screens are one component behind one factory.
 *
 * `react-router` matches `/meta-ads/new` against the parametric route too, so
 * the two declarations are deliberately separate — the editor reads
 * `id === 'new'` as its create mode, which is the behaviour the host route
 * table had when it declared both paths against one imported component.
 */
const editor = (): Promise<{ readonly default: unknown }> =>
  import('./pages/CustomEventMappingEditPage.js');

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/CustomEventMappingsListPage.js'),
      // Read from the route this screen calls — `requireAdmin('meta_ads:read')`
      // on `GET /admin/meta-ads/custom-events` — and the same code the module's
      // `open-meta-ads` palette action declares, which
      // `check:action-route-permissions` holds to that route.
      requiredPermission: 'meta_ads:read',
      index: true,
    },
    {
      path: `${ROUTE_PATH}/new`,
      component: editor,
      // The create form posts to `POST /admin/meta-ads/custom-events`, which
      // enforces the write code — the same code the `new-meta-custom-event`
      // palette action declares for this path.
      requiredPermission: 'meta_ads:write',
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: editor,
      requiredPermission: 'meta_ads:write',
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/meta_ads/i18n/`. It was `appShell.nav.metaAds` in the
      // shared `_i18n` bundle, one of the four shared files a module author had
      // to edit.
      labelKey: 'nav.metaAds.label',
      // The icon the hand-written NAV entry carried.
      icon: 'Sparkles',
      section: 'analyticsAds',
      // Last of the four entries the hand-written NAV gave this section, after
      // `analytics` (100), `google_analytics` (200) and `linkedin_ads` (300).
      weight: 400,
      // The code that opens the screen. The sidebar advertises a destination,
      // so it gates on the read code the landing route enforces and not on the
      // write code its editor does.
      requiredPermission: 'meta_ads:read',
    },
  ],
};
