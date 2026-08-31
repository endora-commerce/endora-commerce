/**
 * `promotions`' admin surface — five routes and two sidebar entries, declared
 * by the module that owns them (feature 091, Phase 4, the plan's batch 7;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The heaviest declaration in the batch on the nav axis**: two sidebar rows
 * for one module, because the Rule Builder is a screen in its own right and not
 * a tab of the promotion list. Both take the read code, which is what
 * `GET /api/v1/admin/promotions` and `GET /api/v1/admin/promotion-rules`
 * enforce; the write and delete codes gate controls **inside** the screens and
 * are not what opens them.
 *
 * **Three of the five routes have no sidebar row and never will** — a nav entry
 * is a landing surface. `/promotions/new`, `/promotions/:id` and
 * `/promotions/:id/stats` are reached from the list, and each is a deep link an
 * operator following a stale bookmark can meet, so each is gated by its own
 * declaration rather than by the list's.
 *
 * **Route order is not declaration order and must not be relied on.**
 * `react-router` v7 *ranks* routes — a literal segment outranks a parameter —
 * so `/promotions/new` wins over `/promotions/:id` whichever way round they are
 * written here. `App.tsx`'s hand-written block put the literals first with a
 * comment saying why; the comment described a rule the router already applies,
 * and the registry renders these in the order this array gives.
 *
 * **Its two sidebar positions do not change.** Every other row in *Pricing* is
 * still host-declared, so `composeNav` appends both after all of them — which
 * is not where the hand-written table had them: `/promotions` and
 * `/promotion-rules` were second and third of six, above `/taxes`,
 * `/delivery-methods` and `/payment-methods`. That is the operator-visible
 * consequence batches one and two both recorded, arriving here for the same
 * structural reason, and the declared weights (200, 300 — the hand-written
 * positions times a hundred) are what restore it once that section's other rows
 * convert. The two keep their order relative to each other, which is the half
 * that can be restored today.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer, and each component is a dynamic-import factory (R6) so Vite has a
 * split point whether or not anybody remembers to ask for one.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the promotion list. */
const LIST_PATH = '/promotions';

/** The Rule Builder, a second landing surface with a sidebar row of its own. */
const RULES_PATH = '/promotion-rules';

/**
 * The code every one of this module's five screens is opened by —
 * `requireAdmin(PROMOTION_PERMISSIONS.READ)` on `GET /api/v1/admin/promotions`
 * and on `GET /api/v1/admin/promotion-rules` (`routes.ts:102`). The write and
 * delete codes gate the save and delete controls the screens render, which is a
 * question about a control and not about a route.
 */
const PERMISSION = 'promotions:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: LIST_PATH,
      component: () => import('./pages/PromotionsPage.js'),
      requiredPermission: PERMISSION,
      index: true,
    },
    {
      path: `${LIST_PATH}/new`,
      component: () => import('./pages/PromotionEditPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${LIST_PATH}/:id`,
      component: () => import('./pages/PromotionEditPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: `${LIST_PATH}/:id/stats`,
      component: () => import('./pages/PromotionStatsPage.js'),
      requiredPermission: PERMISSION,
    },
    {
      path: RULES_PATH,
      component: () => import('./pages/PromotionRulesPage.js'),
      requiredPermission: PERMISSION,
    },
  ],
  nav: [
    {
      to: LIST_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/promotions/i18n/`. It was `appShell.nav.promotions`
      // in the shared `_i18n` bundle, one of the four shared files a module
      // author had to edit.
      labelKey: 'nav.promotions.label',
      // The glyph `AppShell.tsx` rendered by hand for both rows. It joins
      // `KnownIconNameSchema` and the kit's `icon-map.ts` in this merge request
      // rather than the sidebar quietly changing to a name that happened to be
      // on the allowlist.
      icon: 'PercentDiamond',
      section: 'pricing',
      weight: 200,
      requiredPermission: PERMISSION,
    },
    {
      to: RULES_PATH,
      labelKey: 'nav.promotionRules.label',
      icon: 'PercentDiamond',
      section: 'pricing',
      weight: 300,
      requiredPermission: PERMISSION,
    },
  ],
};
