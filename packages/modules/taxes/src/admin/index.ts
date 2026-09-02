/**
 * `taxes`' admin surface — one route and one sidebar entry, declared by the
 * module that owns them (feature 091, Phase 4, batch 8;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its one drain was `dictionaries`' country picker**, which the screen renders
 * to choose the country a tax rule applies to.
 * `backend/scripts/ledgers/cross-module-imports/taxes.ts` recorded it with the
 * retiring condition this batch satisfies — the picker is generic, so it moved
 * into `@endora-commerce/admin-kit` and the shard is deleted rather than
 * edited.
 *
 * **This module declares `activation.nonDeactivatable`**, so its off-state proof
 * is `plan.md`'s Ruling 2 shape: the platform refuses to have an absent state,
 * which is a fact about the module and is asserted as one rather than skipped.
 * The permission axis is real and `useSurfaceVisibility` gates it identically,
 * so the test drives positive control, permission withheld and restored, and
 * reads the lock off the manifest so an unlock fails there.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer; the component is a dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only route: the tax-rule table. */
const ROUTE_PATH = '/taxes';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/TaxesPage.js'),
      // `requireAdmin('taxes:read')` on `GET /api/v1/admin/taxes`, which the
      // screen calls on mount. The write code gates the mutations the same
      // screen offers, so a read-only operator opens it and is refused field by
      // field — the treatment issue #232 says a landing surface must have.
      requiredPermission: 'taxes:read',
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), out of `packages/modules/taxes/i18n/`. It was
      // `appShell.nav.taxes` in the shared `_i18n` bundle.
      labelKey: 'nav.taxes.label',
      icon: 'Receipt',
      section: 'pricing',
      // Second of three in the hand-written *Pricing* table, after
      // `/price-lists` and before `/delivery-methods`. Both of those are still
      // the host's — `price_lists` is batch 9's — so a registry entry appends
      // after them whatever it declares; the weight is what restores the pair's
      // order against `delivery_methods`' 300 once the section converts.
      weight: 200,
      requiredPermission: 'taxes:read',
    },
  ],
};
