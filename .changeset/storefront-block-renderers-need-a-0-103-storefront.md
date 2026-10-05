---
'@endora-commerce/mod-cms': patch
---

The Page Builder extension guide this package ships no longer says that every storefront runs
`blocks:generate`. That is true of a storefront created by release `0.103.0` or later. A storefront
created earlier keeps its source through an upgrade — `endora upgrade` moves its packages only — so
it has no `blocks:generate` script, no `lib/page-builder/` and no rule for a switched-off module's
block until its owner brings those files over. The guide now says so and names where the steps
are: *Upgrading an instance*, under *Module blocks in an existing storefront*. No code changes.
