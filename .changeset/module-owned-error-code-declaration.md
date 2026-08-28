---
"@endora-commerce/contracts": minor
"@endora-commerce/platform": minor
"@endora-commerce/mod-i18n": minor
---

A module can declare the error codes it owns, and a branded type keeps a typo out of a raise site

Feature 090 (`specs/090-module-owned-error-codes/`), Phase 1 of D-182. Nothing routes
differently yet — the prefix chain in `@endora-commerce/mod-i18n` is untouched and is still
what the composition roots inject.

**`@endora-commerce/contracts`**

* `ModuleManifest` gains `errorCodes?: { code: string; tokens?: string[] }[]` — the codes a
  module owns. The sentence for each still lives in the module's own
  `i18n/<language>.json` under `errors.<CODE>`; there is deliberately no `message` field,
  because the raising code's own English already exists and can interpolate.
  `defineModuleManifest` refuses four things, naming the module and the code: a code that is
  not SCREAMING_SNAKE_CASE, the same code twice in one manifest, a refusal token that does not
  match `^[a-z][a-z0-9_]*$`, and the same token twice under one code.
* New: `defineModuleErrorCodes(['ACME_SYNC_REJECTED'])` returns each code as a branded
  `ModuleErrorCode`. This is the authoring shape for a module's own codes, and it is
  mandatory rather than a convenience — a bare string literal is assignable to neither
  `ErrorCode` nor `ModuleErrorCode`, so a typo at a raise site is a compile error. It does
  **not** make a typo in an `error.code === '…'` comparison an error; that is unchanged and
  measured.
* New: `errorCodeRe`, `errorCodeTokenRe`, `ModuleErrorCodeDeclarationSchema`.
* `errorEnvelopeSchema.error.code` relaxes from `z.enum(Object.values(ERROR_CODES))` to a
  regex over the same grammar, so a module-declared code validates. `ERROR_CODES` and
  `ErrorCode` are unchanged and stay closed. `ErrorEnvelope['error']['code']` is now
  `ErrorCode | ModuleErrorCode`: every value valid before is valid after, in both directions.

**`@endora-commerce/platform`**

* `HttpError`'s `code` parameter and field widen from `ErrorCode` to
  `ErrorCode | ModuleErrorCode`. Purely a relaxation; no call site changes.

**`@endora-commerce/mod-i18n`**

* New: `buildErrorTranslationTargets(manifests)`, which derives the routing map from the
  modules' own declarations, and `describeErrorCodeCollisions`. Two modules declaring one
  code routes it to **neither** and names every claimant with the file that declares it —
  there is no tie-break by origin, order or id, because each of those renders one raiser's
  condition under the other's sentence with no symptom anyone can detect. Exported but not
  yet wired: the composition roots still inject `ERROR_TRANSLATION_KEYS`.
* `ErrorTranslationTarget['key']` widens from `errors.${ErrorCode}` to `errors.${string}`.
