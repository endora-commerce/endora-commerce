/**
 * `delivery_methods`' admin surface — one route, one sidebar entry, one
 * command-palette action (through the manifest) and **one zone it renders**
 * (feature 091, Phase 4, batch 8;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its one boundary drain was `dictionaries`' currency picker**, which the
 * screen renders to choose the currency a flat shipping rate is priced in.
 * `backend/scripts/ledgers/cross-module-imports/delivery_methods.ts` recorded
 * it; the picker is generic, so it moved into `@endora-commerce/admin-kit` and
 * the shard is deleted rather than edited.
 *
 * **Its other drain is the one this module is in this batch for**, and it is a
 * zone rather than an import. The list screen carried a hard-coded
 * `dhl_parcel` block and a hard-coded `inpost` block — each with the other
 * module's title, description, route and permission code — which
 * `backend/scripts/ledgers/foreign-module-ids.ts` recorded as two
 * `visibility-gate` couplings with this conversion as their retiring
 * condition. `delivery_method.list.integrations` is the enum member the host
 * renders; both carriers were already packaged, so the host and both
 * contributions land together, which is why `plan.md` put all three here.
 *
 * **The baseline counted `nav: 2` and only one of them is a sidebar row** — the
 * other was a `PALETTE_ITEMS` literal, which `adminNavEntries` reads because it
 * carries `to` and `module`. It arrives as a manifest action
 * (`open-delivery-methods`) instead, which is the surface the server's
 * effective enabled-set filters rather than a copy nobody asked it about.
 *
 * **This entry exports data and nothing else** (R2); the component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only route: the shipping-method list and its editor form. */
const ROUTE_PATH = '/delivery-methods';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/DeliveryMethodsPage.js'),
      // `requireAdmin('delivery_methods:read')` on
      // `GET /api/v1/admin/delivery-methods`, which the screen calls on mount,
      // and the code its own `useSurfaceVisibility` gate has asked for since
      // 2026-08-28 — the module stopped borrowing `catalog:read` then.
      requiredPermission: 'delivery_methods:read',
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), out of
      // `packages/modules/delivery_methods/i18n/`. `appShell.nav.deliveryMethods`
      // **stayed** in `_i18n` through batch 8 rather than moving with this row:
      // it was also the parent crumb of the two carrier trails that batch left
      // standing (`/delivery-methods/dhl-parcel` and `/settings/inpost`, whose
      // modules contribute no nav entry for `registryCrumbs` to derive from),
      // so deleting it then would have rendered a raw key on two screens that
      // batch did not touch. That was batch 7's `appShell.nav.paymentMethods`
      // asymmetry, met a second time and for the same reason, and it retired
      // when those two trails did — feature 134's wave 1 (FR-023), which took
      // both `CRUMB_DICT` rules out because `dhl_parcel` and `inpost` leave
      // this repository. `appShell.nav.paymentMethods` is still standing and
      // retires with wave 2's five.
      labelKey: 'nav.deliveryMethods.label',
      icon: 'Truck',
      section: 'pricing',
      // Third of three in the hand-written *Pricing* table, after `/taxes`.
      // Both surviving rows there are the host's, so a registry entry appends
      // after them whatever it declares; the weight is what keeps this below
      // `taxes`' 200 once the section converts.
      weight: 300,
      requiredPermission: 'delivery_methods:read',
    },
  ],
};
