---
'@endora-commerce/mod-dictionaries': patch
---

`dictionaries` declares the eight error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied from the frozen
capture, and is asserted equal to it in both directions.

Six of the eight are raised outside this package — `currencies` and `languages`
own the rows this module is the screen over, and nine consumer modules re-raise
`DICTIONARY_ENTRY_INACTIVE` from a caught `DictionaryReferenceError`. Ownership
follows the domain noun and not the thrower, so the sentences stay here.

No `tokens` are declared: none of the eight carries a refusal discriminator.
`UNKNOWN_CURRENCY_CODE` and `UNKNOWN_LANGUAGE_CODE` are not here — they read
like this module's and are `sales_channels`', which declares them.
