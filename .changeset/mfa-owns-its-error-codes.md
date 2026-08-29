---
'@endora-commerce/mod-mfa': patch
---

`mfa` declares the ten error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied verbatim from the
frozen capture, and is asserted equal to it in both directions.

`TWO_FACTOR_REQUIRED` and `TWO_FACTOR_REQUIRED_BY_ROLE` are deliberately not
among them. Both name this module's subject, neither carries the `MFA_` prefix,
so both fall off the end of the chain to `core` — and the declaration follows
the chain's answer rather than the noun.

All ten already carry a written sentence in both `en` and `pl` in this package's
own `i18n/` bundles, so no sentence moves and none is added. No `tokens`: none
of the fourteen raise sites of these ten codes passes a fourth argument to
`HttpError` at all, so there is no `details.code` for the envelope to read.
