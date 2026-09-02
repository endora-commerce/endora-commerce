---
'@endora-commerce/mod-megamenu': patch
---

`megamenu` declares the ten error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied verbatim from the
frozen capture, and is asserted equal to it in both directions.

All ten already carry a written sentence in both `en` and `pl` in this package's
own `i18n/` bundles, and those ten are exactly the `errors.*` keys those bundles
hold, so no sentence moves and none is added.

No `tokens`: all sixteen raise sites of these ten codes were read across
`packages` and `backend/src`, and every one of them passes three arguments to
`HttpError` and no fourth at all, so none can carry the `details.code`
discriminator the envelope reads.

Two of the ten reach no envelope, and both are reported rather than repaired
here. `MEGAMENU_DEPTH_EXCEEDED` is a soft, non-blocking warning delivered in
`meta.warnings` on a **200** (feature 015 FR-011), so it is never thrown.
`MEGAMENU_REFERENCED` names a refusal this module contributes to — its asset and
CMS reference scanners do block the upstream delete — but the refusal is
answered under the deleting module's code, `ASSET_REFERENCED` or
`CMS_REFERENCED`. Both keep their declarations, because ownership follows the
frozen capture and this change moves no answer.
