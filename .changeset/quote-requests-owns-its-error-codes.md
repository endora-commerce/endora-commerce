---
'@endora-commerce/mod-quote-requests': patch
---

`quote_requests` declares the nine error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the
`RFQ_`/`QUOTE_` prefix rule in `@endora-commerce/mod-i18n`, which continues to
answer identically for every one of them: the list is the chain's own answer,
copied from the frozen capture, and is asserted equal to it in both directions.

No `tokens` are declared: none of the nine carries a refusal discriminator —
all ten raise sites of the three codes anything raises pass no `details.code`,
and the other six are raised by nothing at all.
