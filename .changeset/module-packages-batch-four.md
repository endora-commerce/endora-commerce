---
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-custom-fields': minor
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-email': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-settings': minor
---

Seven more modules become workspace packages (feature 080, T040b batch four):
`assets_library`, `carts`, `custom_fields`, `customers`, `email`, `invoices` and
`settings`. Each ships `dist` and resolves through its own `exports` map — the
root for its manifest, `./backend` for `registerModule` plus the `entities`
array, `./migrations` for its migration classes where it owns any — exactly as
the forty-three packages before them.

Three things a consumer of one of these packages should know.

**`@endora-commerce/mod-carts`, `@endora-commerce/mod-custom-fields` and
`@endora-commerce/mod-invoices` publish a `./ports` subpath.** It is type-only:
`tsc` emits `export {};`, and it is where a consumer names
`CartPlacementApplyPort`, `CustomFieldDefinitionApplyApi` and
`InvoicePlacementApplyPort` instead of reaching into the owner's directory.

```ts
import type { CartPlacementApplyPort } from '@endora-commerce/mod-carts/ports';
```

The implementations stay behind their container names
(`cartPlacementApplyPort`, `customFieldDefinitionApplyApi`,
`invoicePlacementApplyPort`) and are resolved with `lazyPort`, never through
this subpath.

**`@endora-commerce/mod-settings` declares `entities` as an empty array.** The
module owns no table — the settings store is the platform's — and the empty
array is the statement, because the host reads a *missing* export as `[]` and a
forgotten one would be indistinguishable from an honest none.

**No entity class is exported by name from any of the seven**, `import type`
included (D-168). A consumer that must construct one takes it off the published
`entities` array by name; `Cart`, `Invoice` and the rest are deliberately not
importable.
