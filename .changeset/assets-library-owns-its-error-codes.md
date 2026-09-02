---
'@endora-commerce/mod-assets-library': patch
---

`assets_library` declares the fifteen error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied from the frozen
capture, and is asserted equal to it in both directions.

No `tokens` are declared: none of the fifteen carries a refusal discriminator.
`ASSET_KIND_NOT_SUPPORTED` is not here — it carries this module's prefix and is
`catalog`'s, which declares it.
