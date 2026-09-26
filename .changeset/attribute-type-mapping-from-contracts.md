---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-pim-unopim': patch
'@endora-commerce/mod-pim-ergonode': patch
'@endora-commerce/mod-pim-pimcore': patch
---

These modules derive an attribute's API type from `@endora-commerce/contracts`' `apiAttributeTypeOf` instead of each carrying its own copy of the rule. `catalog`'s `dbToApiAttributeType` keeps its `numericKind`; `pim_unopim` and `pim_ergonode` check a binding candidate against the shared function. The internal `endoraApiAttributeTypeOf` helper is removed from `pim_unopim`, `pim_ergonode` and `pim_pimcore`; no published subpath exported it.

Behaviour is unchanged. The modules require a `@endora-commerce/contracts` release that exports `apiAttributeTypeOf`.
