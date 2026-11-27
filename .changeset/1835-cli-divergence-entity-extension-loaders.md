---
'@endora-commerce/cli': patch
---

`module:divergence` classifies the new `ctx.entityExtensionLoaders` seam (`specs/187-side-table-extensions/` B1) as the module's own surface: a side-table loader reads the extending module's own declared table and is attached to a host read only when the caller names that module in `include`, so it changes nothing core answers. Without the entry every deployment reported an `unclassified-seam` finding.
