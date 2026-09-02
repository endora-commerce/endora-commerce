---
'@endora-commerce/mod-invoices': patch
---

`invoices` declares the three error codes it owns, and the four refusal tokens under two of them.

The module's `manifest.ts` gains an `errorCodes` array
(`specs/090-module-owned-error-codes/`, Phase 3), which is what routes each code's translated
sentence to this package's own `i18n/{en,pl}.json` under `errors.<CODE>`. No exported symbol
changes shape and no sentence moves: the list is exactly what the platform's incumbent prefix
chain routes here today, so a consumer sees the identical envelope for `INVOICE_NOT_READY`,
`INVOICE_NUMBER_ALREADY_ISSUED` and `INVOICE_NUMBER_PATTERN_COLLIDES`.

The `tokens` come off the raise sites rather than off the bundle, because the envelope's
`refusalToken` reads exactly one member of `details` and the token set is the set of values a
raise site can put there. This module writes bare string literals — `same_channel` /
`other_channel` for a duplicated number, `no_sequence_token` / `other_channel` for an illegal
numbering pattern — across three throws in two files, so the set is complete once those throws
are enumerated rather than by following a type.
