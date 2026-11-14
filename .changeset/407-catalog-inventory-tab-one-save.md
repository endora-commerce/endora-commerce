---
'@endora-commerce/mod-catalog': minor
---

The product editor's Inventory tab now saves its product-row settings with the editor's one Save (issue #407, owner ruling OQ-7 = B): stock management, backorders, the low-stock threshold and its mode, and the fulfilment strategy.

- These settings are staged as Global changes and counted by the editor's Save.
- They are written in its `PUT …/scoped-values` call, in `changes.product`, instead of through `PATCH …/products/:id`. The tab now reads them from the editor's scoped read.
- The tab's *Save threshold* and fulfilment *Save* buttons are removed.
- Changing the threshold mode no longer saves on its own.
- Per-warehouse stock levels and thresholds still save immediately, under an "Applies immediately" badge on the *Stock by warehouse* table. The tab's *Stock* heading no longer carries the badge.
- `ProductInventoryTab` takes an optional `editable` prop.
- The unused `inventoryTab.*.saved` and `inventoryTab.lowStock.success` strings are removed.
