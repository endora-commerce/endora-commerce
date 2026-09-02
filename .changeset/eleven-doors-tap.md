---
'@endora-commerce/mod-inventory': patch
---

`inventory` declares the thirteen error codes it owns.

The module's `manifest.ts` gains an `errorCodes` array
(`specs/090-module-owned-error-codes/`, Phase 3), which is what routes each code's translated
sentence to this package's own `i18n/{en,pl}.json` under `errors.<CODE>`. No exported symbol
changes shape and no sentence moves: the list is exactly what the platform's incumbent prefix
chain routes here today, so a consumer sees the identical envelope for all thirteen. What
changes is where the answer comes from — the module's own manifest rather than a table inside
`@endora-commerce/mod-i18n` that a module outside this repository could never join.
