---
'@endora-commerce/mod-carts': patch
---

`services/cart-availability.ts` no longer re-exports `firstLanguageTag` (issue #1011). Nothing in the module reads it since the basket resolves its language through `requestScopeLanguage`, and the helper itself stays in `@endora-commerce/contracts`. The file is not on the package's export map, so no published entry point changes.
