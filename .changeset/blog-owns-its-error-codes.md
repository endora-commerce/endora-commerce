---
'@endora-commerce/mod-blog': patch
---

`blog` declares the nineteen error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied verbatim from the
frozen capture, and is asserted equal to it in both directions.

All nineteen already carry a written sentence in both `en` and `pl` in this
package's own `i18n/` bundles, so no sentence moves and none is added. No
`tokens`: no code this module raises passes a `details.code` discriminator.
