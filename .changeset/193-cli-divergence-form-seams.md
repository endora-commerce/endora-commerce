---
'@endora-commerce/cli': patch
---

`module:divergence` classifies the new `ctx.fieldSets` and `ctx.fieldFormats` seams (`specs/193-admin-form-extensions/` WP-B) as the module's own surface: the first lists the writers of a field set only its owner may register, the second validates a format in the module's own namespace. Without the entries every deployment reported an `unclassified-seam` finding.
