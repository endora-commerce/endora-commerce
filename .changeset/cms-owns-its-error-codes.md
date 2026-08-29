---
'@endora-commerce/mod-cms': patch
---

`cms` declares the ten error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied verbatim from the
frozen capture, and is asserted equal to it in both directions.

`CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE` is among them despite naming two other
modules' nouns — it is this module's refusal, raised twice in
`cms-page-service.ts` — and `CMS_REFERENCED` is the cross-entity reference guard
for pages, blocks and templates rather than a narrowing of `assets_library`'s
`ASSET_REFERENCED`. Going the other way, the seven raises this module makes of
`VERSION_CONFLICT` and `VALIDATION_FAILED` are the platform's codes and are not
declared here.

All ten already carry a written sentence in both `en` and `pl` in this package's
own `i18n/` bundles, so no sentence moves and none is added. No `tokens`: none
of the 32 raises of these codes passes a `details.code` discriminator.
