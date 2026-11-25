---
'@endora-commerce/mod-search': minor
---

`searchReindexPort` gains `reindexProducts(productIds)` (issue #1907): re-reads the named products
into every channel index, for a catalogue write that announces no event — an Organization merge's
audience batch.
