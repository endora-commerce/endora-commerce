---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-seo': minor
'@endora-commerce/mod-taxes': minor
'@endora-commerce/mod-credit-limits': minor
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/mod-megamenu': minor
'@endora-commerce/mod-returns': minor
'@endora-commerce/mod-dhl-parcel': minor
'@endora-commerce/mod-inpost': minor
---

Six modules ship their admin surfaces, and the delivery-methods list becomes a zone its
carriers contribute to.

**New `./admin` subpath on six packages.** `@endora-commerce/mod-seo`,
`mod-taxes`, `mod-credit-limits`, `mod-delivery-methods`, `mod-megamenu` and `mod-returns`
each export `contributions` — an `AdminContributions` object — from
`@endora-commerce/mod-<id>/admin`. Every component is a dynamic-import factory, so a
consumer's bundler emits one chunk per screen. The routes are unchanged: `/seo`, `/taxes`,
`/credit-limits`, `/delivery-methods`, `/megamenu` plus `/megamenu/:id`, and `/returns`
plus its four sub-screens.

Three things a consumer has to know about that half:

- **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
  each package's new `tsconfig.ui.json`; a checkout that has not run
  `pnpm run build:packages` cannot resolve it.
- **`@endora-commerce/admin-kit` and `react` become peer dependencies of all six.** The kit
  is where every screen's design-system import resolves, and `react` is peered rather than
  depended on so the application resolves one copy.
- **Each package now ships an `i18n/` bundle carrying its own `nav.*.label`.** The sidebar
  label is module-relative — `nav.seo.label`, `nav.taxes.label`, `nav.creditLimits.label`,
  `nav.deliveryMethods.label`, `nav.megamenu.label`, `nav.returns.label` — resolved in the
  module's own namespace instead of the shared `core` one.

**New in `@endora-commerce/contracts`:**

- `AdminZoneNameSchema` gains `'delivery_method.list.integrations'`, the first member whose
  host is not the product editor, with `DeliveryMethodIntegrationsZoneProps` (empty: the
  host renders one card per shipping integration and has no identifier to name one by) and
  its `AdminZonePropsMap` entry.
- `KnownIconNameSchema` gains `'Newspaper'`, which `megamenu`'s sidebar entry names now
  that it declares its own row rather than importing the glyph.

**New in `@endora-commerce/admin-kit`:** `DeliveryMethodIntegrationsZoneProps` is re-exported
from `./contributions`, and `resolveIcon('Newspaper')` answers.

**`mod-dhl-parcel` and `mod-inpost` each gain a zone contribution**, on the `./admin`
subpath they already had:

```ts
zoneComponent('delivery_method.list.integrations', () => import('./zones/DeliveryMethodIntegrationCard.js'), {
  weight: 100,
  requiredPermission: 'dhl_parcel:read',
})
```

`delivery_methods` used to render both cards itself, with each carrier's title, description,
route and permission code written into its own file. A third carrier now needs no edit to a
file its author does not own, and the presence gate, the permission gate and the ordering are
the zone renderer's.

Nothing is removed and no existing export changes shape, so a consumer of any package's
`./backend`, `./migrations` or root subpath is unaffected.
