---
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-price-lists': patch
---

Both manifests declare `demo: false`.

It records a decision rather than adding a capability: neither module has demo data of its own.
The demo shop's megamenu mirrors another module's demo category tree and binds to the demo sales
channels, and the demo's prices are a backfill over another module's demo products into this
module's default list. Each is more than one module's rows in one step, so each belongs to the
instance's own demo composition and to no module.

**If you read `manifest.demo`**, these two now answer `false` where they answered `undefined`.
The two are deliberately different states: `false` is a decision that the module owes nothing,
`undefined` is a module nobody has looked at yet.
