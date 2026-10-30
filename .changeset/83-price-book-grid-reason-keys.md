---
'@endora-commerce/mod-price-lists': patch
---

The price book grid's per-rule cell reasons moved from the `errors.reason.*` bundle keys to `grid.reason.*`, because `errors.*` is reserved for the error envelope's sentences. A deployment that overrides those strings in its own bundle renames the keys.
