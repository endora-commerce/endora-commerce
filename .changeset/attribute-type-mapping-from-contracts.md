---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-pim-ergonode': patch
---

These modules derive an attribute's API type from `@endora-commerce/contracts`' `apiAttributeTypeOf` instead of each carrying its own copy of the rule. `catalog`'s `dbToApiAttributeType` keeps its `numericKind`; `pim_ergonode` checks a binding candidate against the shared function (`pim_unopim` made the same move and has since left this repository; its version with the change is cut from the paid-modules repository). The internal `endoraApiAttributeTypeOf` helper is removed from `pim_unopim`, `pim_ergonode` and `pim_pimcore`; no published subpath exported it.

Behaviour is unchanged. The modules require a `@endora-commerce/contracts` release that exports `apiAttributeTypeOf`.

`@endora-commerce/mod-pim-pimcore` carries this change as well; it has left for the paid-modules repository, and its next version is cut there.
