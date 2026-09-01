---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-pim-ergonode': minor
'@endora-commerce/mod-pim-pimcore': minor
---

Field protection is published surface, and both PIM connectors contribute it.

`@endora-commerce/admin-kit` gains a subpath, `./field-protection`, exporting
`useFieldProtection`, `FieldProtectionToggle`, `FieldProtectionSummary`,
`FieldProtectionPricePanel`, `describeFieldPath`, `controlIdPrefix` and the types
`FieldProtectionSource`, `FieldProtectionView`, `FieldProtectionEntry`,
`FieldProtectionPricePath` and `FieldProtectionApi`. It holds the per-scope store, the
mount de-duplication and the optimistic write with its rollback, and it holds no HTTP
knowledge at all: `load`, `save`, the translator and the source label arrive on one
`FieldProtectionSource` prop from the integration that owns them.

```ts
import { FieldProtectionToggle } from '@endora-commerce/admin-kit/field-protection';

const source = {
  scopeKey: `my_pim:${productId}`,   // keys the store and prefixes the DOM ids
  sourceLabel: 'My PIM',             // what the operator calls the integration
  t: useTranslation('my_pim'),       // reads fieldProtection.* out of your bundle
  load: async () => (await client.get(productId)).data,
  save: async (protections) => (await client.replace(productId, { protections: [...protections] })).data,
};

<FieldProtectionToggle source={source} fieldPath="name" languageCode="pl-PL" />;
```

`@endora-commerce/mod-pim-ergonode` gains an `./admin` subpath declaring three zone
contributions — `product.editor.details.before`, `product.editor.pricing.before` and
`product.editor.field.after` — and `@endora-commerce/mod-pim-pimcore` adds the same three
to the ones it already declared, together with `pimcoreProtectionsClient` on its `./admin`
export. Neither ships a control of its own any more, so a platform carrying both PIMs
renders one control per connected integration instead of two implementations of one
concept.

Consumers that imported `FieldProtectionToggle`, `FieldProtectionSummary`,
`ErgonodePriceProtectionPanel` or `ErgonodeAttributeValueProtection` from
`admin/src/modules/pim_ergonode/components/FieldProtectionToggle` render an
`<AdminZone>` instead: the file is deleted and no re-export shim replaces it, because the
whole point of the change is that a host names no integration.
