---
'@endora-commerce/mod-sales-channels': patch
---

`sales_channels` declares the twelve error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied verbatim from the
frozen capture, and is asserted equal to it in both directions.

`UNKNOWN_OPTION` is deliberately not among them. This module's rule in the chain
is the `UNKNOWN_` prefix, but `catalog` claims that code two branches earlier, so
the chain's answer is `catalog` and the declaration follows the answer.

All twelve already carry a written sentence in both `en` and `pl` in this
package's own `i18n/` bundles, so no sentence moves and none is added. No
`tokens`: no raise site of any of the twelve passes a `details.code`
discriminator.
