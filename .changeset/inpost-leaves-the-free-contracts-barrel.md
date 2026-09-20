---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-delivery-methods': patch
---

`@endora-commerce/contracts` no longer exports InPost's schemas; a carrier integration publishes its own

**If you import any `inpost*` symbol from `@endora-commerce/contracts`, this release removes it.**
Twenty-one exports go — `inpostConfigSchema`, `inpostConfigUpdateSchema`,
`inpostGeowidgetConfigSchema`, `inpostLockerShippingAdapterDataSchema`, `inpostModeSchema`,
`inpostAdapterKeySchema`, `inpostSendingMethodSchema`, `inpostParcelTemplateSchema`,
`inpostLabelSizeSchema`, `inpostLabelErrorCodeSchema`, `normalizePolishMobilePhone` and each
inferred type beside them. They are now on `@endora-commerce/mod-inpost`'s own `./contracts`
subpath:

```diff
- import { inpostConfigSchema, normalizePolishMobilePhone } from '@endora-commerce/contracts';
+ import { inpostConfigSchema, normalizePolishMobilePhone } from '@endora-commerce/mod-inpost/contracts';
```

**Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
package. A schema describing InPost's ShipX API is only usable by an instance that installs the
InPost module, so shipping it here asked every consumer to carry ~5 300 lines of per-vendor
contract for integrations most of them will never run — and, once a carrier module is published
from somewhere else, put the schema and the code it describes under two owners. The module now
carries both.

`minor` rather than `major`: no package in this repository leaves `0.x` before the move to public
npmjs, and in a `0.x` series a minor already takes every caret dependent out of range, which is
the whole consumer-facing meaning of a break.

**A new published subpath, `./contracts`, exists on module packages from this release.** It is
rendered from a `src/contracts/` directory and appears only on a package that has one; nothing
else in the estate changes shape. `@endora-commerce/mod-inpost` is the first to use it.

`@endora-commerce/mod-delivery-methods` is a documentation patch, and the reason is the same
split: its page linked a sibling carrier's page, which is a broken link in every instance that
does not install that carrier. It now names carrier modules without linking one.
