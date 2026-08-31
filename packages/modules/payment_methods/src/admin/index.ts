/**
 * `payment_methods`' admin surface — one route and one sidebar entry, declared
 * by the module that owns them (feature 091, Phase 4, the plan's batch 7;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **It is a two-file layer plus a renderer table**, and the third file is worth
 * a sentence because it looks like a cross-module seam and is not:
 * `renderers/registry.tsx` maps a *provider code* to the small configuration
 * form that provider's method needs. Every entry in it is this module's own
 * markup over this module's own client; the gateway packages contribute
 * nothing to it, which is why this batch's `check:module-boundary` line does
 * not move for this module.
 *
 * **Its sidebar position does not change.** Every other row in *Pricing* is
 * still host-declared, so `composeNav` appends this one after all of them —
 * which is where the hand-written table already had it, last of six. The
 * declared weight (600, the hand-written position times a hundred, batch four's
 * convention) is what will restore the order once that section's other rows
 * convert.
 *
 * **One shared label deliberately stays in `_i18n`.** The sidebar entry's own
 * label moves into this module's bundle, but `appShell.nav.paymentMethods` is
 * *also* the parent crumb of five gateway trails still hand-written in
 * `CRUMB_DICT` (`/settings/{tpay,stripe,payu,autopay,paypal}`), which batch five
 * deliberately left standing because those five modules contribute no nav entry
 * for `registryCrumbs` to derive from. Deleting the key would render five raw
 * keys on five screens this batch does not touch. It goes when those trails do.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer, and each component is a dynamic-import factory (R6) so Vite has a
 * split point whether or not anybody remembers to ask for one.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only admin route: the method catalogue and its editor. */
const ROUTE_PATH = '/payment-methods';

/**
 * The code the screen's entry route enforces —
 * `requireAdmin('payment_methods:read')` on
 * `GET /api/v1/admin/payment-methods` (`routes.ts:125`). The module took its
 * own authority on 2026-08-28; before that these screens were gated by
 * `catalog:read` / `catalog:write`, so whoever could edit a product could
 * rewrite which methods a checkout offers.
 */
const PERMISSION = 'payment_methods:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/PaymentMethodsPage.js'),
      requiredPermission: PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace. The
      // shared `appShell.nav.paymentMethods` stays where it is for the five
      // gateway breadcrumbs that still name it — see the note above.
      labelKey: 'nav.paymentMethods.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema` — this module's own palette action names it.
      icon: 'CreditCard',
      section: 'pricing',
      weight: 600,
      requiredPermission: PERMISSION,
    },
  ],
};
