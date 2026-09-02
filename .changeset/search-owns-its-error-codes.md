---
'@endora-commerce/mod-search': patch
---

`search` declares the eight error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied verbatim from the
frozen capture, and is asserted equal to it in both directions.

All eight already carry a written sentence in both `en` and `pl` in this
package's own `i18n/` bundles, and those eight are exactly the `errors.*` keys
those bundles hold — none is an `UNTRANSLATED_ERROR_CODES` entry — so no
sentence moves and none is added.

Six of the eight — `LIMIT_OUT_OF_RANGE`, `PHRASE_REQUIRED`, `PHRASE_TOO_LONG`,
`QUERY_TOO_LONG`, `QUERY_TOO_SHORT`, `RESULT_COUNT_INVALID` — carry no `SEARCH_`
prefix and read as generic request-validation codes. They are this module's:
`routes.public.ts` hand-parses the suggest query precisely so a bad `q` or
`limit` refuses with one of them instead of the generic `VALIDATION_FAILED`.
Nothing else in the repository raises any of the six.

No `tokens`: all seven raise sites of these eight codes were read across
`packages` and `backend/src`, and none passes a `details.code` discriminator —
the six that pass a fourth argument at all pass the Zod-style
`Array<{path, issue}>`, which the envelope ignores by construction.
