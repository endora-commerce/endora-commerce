---
'@endora-commerce/mod-i18n': patch
---

`_i18n` declares the platform's 100 error codes, and `translate` answers to the module id as
well as to the bundle namespace.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3, the last owner
(`specs/090-module-owned-error-codes/core-block-home.md`). The list is the prefix chain's own
answer for every code it routes to `core`, copied verbatim from the frozen capture and asserted
equal to it in both directions. `core` is not a module id: it is the synthetic namespace this
package's bundle is exposed under, so the module that owns the platform bundle is this one, and
declaring the block here moves no sentence and edits no bundle.

**One behavioural change, and it is the reason this is not a manifest-only patch.**
`I18nService.translate(moduleId, …)` now resolves `_i18n` to the same bundle as `core`. Before
this, the merged bundle map held a `core` key and no `_i18n` key, so
`translate('_i18n', 'errors.INTERNAL', 'pl')` returned the placeholder — and both composition
roots turn a placeholder back into the raising code's untranslated English. With the block
declared, the composed routing map answers `_i18n` where the chain answered `core`, so without
the normalisation 41 error codes would have lost their sentences in both shipped languages, with
no log and no failing check.

If you call `translate` yourself: `core` keeps working exactly as before and is still what the
admin SPA asks for; `_i18n` now works too. The **placeholder** a miss returns is still built from
the id you passed, so a caller comparing the answer to `` `${moduleId}.${key}` `` is unaffected.
`getCoverageSnapshot` is unchanged — a fallback logged for `_i18n` is attributed to `core`, the
namespace its bundle side is keyed by, rather than reported as a second module with no bundle.

No routing code is touched: the prefix chain still answers for every code whose owner has not
declared it yet, and it is deleted in the next merge request.
