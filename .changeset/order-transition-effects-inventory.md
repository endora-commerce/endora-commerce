---
'@endora-commerce/mod-inventory': minor
---

`inventoryStockReadPort` answers which stock allocations are still held.

The module's implementation of `InventoryStockReadPort` gains `unreleasedAllocationsForOrderItems(orderItemIds)`: the allocations with no `released_at` for the given order items, as `{ orderItemId, warehouseId, quantity }`. `orders`' repair command uses it to list cancelled orders that still hold stock before releasing anything. An empty input answers `[]` without a query.

Nothing else about the module changes: the reservation and the release are the same, and with `inventory` switched off a cancelled order's allocations are now released automatically once the module is switched back on, where before they stayed held.
