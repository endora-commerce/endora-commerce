---
'@endora-commerce/cli': patch
---

The check estate gains `check:block-names`.

`ESTATE` is reconciled against `check-inventory.test.ts` in both directions, so the entry
is what stops the new rule arriving as a silent skip — the thing the manifest exists
against. It is classified `scope: 'package'`, `tier: 'B'`, `host: pending('Phase 4')`, with
three `partial` signals whose subjects are a **pair** of manifests or another package's
renderer map and which a lone module package therefore cannot supply:
`duplicate-block-name`, `category-presentation-disagreement` and
`renderer-without-declaration`. Its subject declaration is `blocks` in the module manifest,
so a package that declares none is reported `not-applicable` with that sentence rather than
skipped.
