---
'@endora-commerce/platform': patch
---

`overlay/index.ts`' header no longer says the divergence renderer stays beside the two
committed renderings it produces. It moved to `@endora-commerce/cli` with the derivation that
feeds it: the report has a second host — a client's instance renders one over its own `apps/`
tree — and a build-time renderer has no runtime reader that would justify a package every
instance loads at boot carrying it. No exported value or type changes.
