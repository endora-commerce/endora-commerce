---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-inventory': patch
---

The product editor, the customer and organization detail screens and the sales-channel editor's warehouse routing panel draw their "Applies immediately" badges with `@endora-commerce/admin-kit`'s `ImmediateBadge` instead of a local copy each (issue #407). The badge looks and reads the same. The module strings it replaces are removed in English and Polish: `productEditor.immediate.badge` (catalog), `detail.immediate.badge` (customers, organizations) and `warehouses.channel.immediateBadge` (inventory).
