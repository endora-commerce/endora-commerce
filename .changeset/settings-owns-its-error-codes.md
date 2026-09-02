---
'@endora-commerce/mod-settings': patch
---

`settings` declares the ten error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied verbatim from the
frozen capture, and is asserted equal to it in both directions.

Nine of the ten already carry a written sentence in both `en` and `pl` in this
package's own `i18n/` bundles, and those nine are exactly the `errors.*` keys
those bundles hold, so no sentence moves and none is added.
`SETTING_SECRET_KEY_MISSING` is an `UNTRANSLATED_ERROR_CODES` entry today and
stays one.

No `tokens`: all seventeen raise sites of these ten codes were read across
`packages` and `backend/src`, and none passes a `details.code` discriminator —
the two that pass a fourth argument at all pass the Zod-style
`Array<{path, issue}>`, which the envelope ignores by construction.
