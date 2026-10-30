---
'@endora-commerce/contracts': patch
---

`ModuleErrorCodeDeclarationSchema`'s documentation now states that a code raised with a computed `details.code` must declare its `tokens`, and that `tokens: []` is a declaration — the raise's `details` never carries a `code` — rather than an absence. The schema itself is unchanged.
