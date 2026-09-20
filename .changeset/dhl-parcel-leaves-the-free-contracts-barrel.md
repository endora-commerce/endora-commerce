---
'@endora-commerce/contracts': minor
---

`@endora-commerce/contracts` no longer exports DHL Parcel's schemas; a carrier integration publishes its own

**If you import any `dhlParcel*` or `DhlParcel*` symbol from `@endora-commerce/contracts`, this
release removes it.** Twenty-two exports go — `dhlParcelModeSchema`,
`dhlParcelAdapterKeySchema`, `dhlParcelLabelTypeSchema`, `dhlParcelConfigSchema`,
`dhlParcelConfigUpdateSchema`, `dhlParcelPickupPointSchema`,
`dhlParcelPickupPointListSchema`, `dhlParcelPickupPointQuerySchema`,
`dhlParcelShipmentDocumentSchema`, `dhlParcelCourierBookingRequestSchema`,
`dhlParcelConnectionCheckSchema` and each inferred type beside them. They are now on
`@endora-commerce/mod-dhl-parcel`'s own `./contracts` subpath:

```diff
- import { dhlParcelConfigSchema, type DhlParcelAdapterKey } from '@endora-commerce/contracts';
+ import { dhlParcelConfigSchema, type DhlParcelAdapterKey } from '@endora-commerce/mod-dhl-parcel/contracts';
```

**Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
package. A schema describing DHL24's SOAP API is only usable by an instance that installs the DHL
Parcel module, so shipping it here asked every consumer to carry per-vendor contract for an
integration most of them will never run — and, once a carrier module is published from somewhere
else, put the schema and the code it describes under two owners. The module now carries both.
This is the same move `@endora-commerce/mod-inpost` made one release earlier, and DHL Parcel is
the last carrier it applies to.

`minor` rather than `major`: no package in this repository leaves `0.x` before the move to public
npmjs, and in a `0.x` series a minor already takes every caret dependent out of range, which is
the whole consumer-facing meaning of a break.

**Nothing else in the estate changes shape.** The `./contracts` subpath is not new — it arrived
with `@endora-commerce/mod-inpost` — and it is rendered from a `src/contracts/` directory, so it
appears only on a package that has one.

**No changeset names `@endora-commerce/mod-dhl-parcel`, and that is deliberate.** This merge
request deletes that package from this repository; the module is published from the repository
that now holds its source, and a changeset for a package this branch deletes has nothing to
version.

**And none names `@endora-commerce/mod-delivery-methods` either**, which it did when
`mod-inpost` left: that release was the one where its shipped page stopped linking a departing
sibling, and the page already names carrier modules without linking one. Checked rather than
assumed — no `.md` shipped by any package links a DHL page.
