---
'@endora-commerce/mod-comparisons': patch
---

`comparisons` declares the four error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied verbatim from the
frozen capture, and is asserted equal to it in both directions.

`COMPARISON_EMPTY`, `COMPARISON_FULL`, `COMPARISON_NOT_FOUND` and
`PDF_GENERATION_FAILED` are the four. `PRODUCT_NOT_IN_COMPARISON` is **not**
among them: it names this module's own noun and is raised only by this package,
and it is `catalog`'s — the chain's `PRODUCT_` rule runs before the
`COMPARISON_` one, and re-routing is out of scope for this change. Going the
other way, this package raises `PRODUCT_NOT_IN_COMPARISON` and
`PRODUCT_NOT_FOUND` (`catalog`'s) and `INTERNAL` and `VALIDATION_FAILED` (the
platform's), none of which is declared here.

All four already carry a written sentence in both `en` and `pl` in this
package's own `i18n/` bundles, so no sentence moves and none is added. No
`tokens`: not one of the six raises of these codes passes a fourth argument, so
no `details.code` discriminator can exist.
