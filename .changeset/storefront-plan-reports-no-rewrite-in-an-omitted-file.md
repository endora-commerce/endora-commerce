---
'@endora-commerce/cli': patch
---

`endora new storefront`'s plan no longer reports a rewrite inside a file it omits. `test/tailwind-module-package-sources.test.ts` had one reference retargeted and was then left out for another, so the same report listed it under both `rewrites` and `omitted`. `plan.rewrites` now names only files that are written.
