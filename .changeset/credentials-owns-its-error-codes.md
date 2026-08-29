---
'@endora-commerce/mod-credentials': patch
---

`credentials` declares the six error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
every one of them: the list is the chain's own answer, copied from the frozen
capture, and is asserted equal to it in both directions.

No `tokens` are declared: none of the six carries a refusal discriminator.
`refusalToken` reads `details.code` off a free-form object, and of this module's
twelve raises nine pass no fourth argument at all, two pass the Zod-style
`Array<{path, issue}>` that the envelope returns `null` for, and one passes an
object whose only member is `referencedBy`.

`INVALID_CREDENTIALS` is not here — it is auth's sign-in failure and routes to
`core`, as do `KSEF_CREDENTIAL_EXISTS` and `KSEF_CREDENTIAL_INVALID`.
`SETTING_SECRET_KEY_MISSING` is `settings`', although it is raised out of a
secret codec this package ships a copy of.
