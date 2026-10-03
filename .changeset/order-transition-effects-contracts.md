---
'@endora-commerce/contracts': minor
---

Two read methods and one optional response field, for order transitions that record what they owe.

- `InventoryStockReadPort.unreleasedAllocationsForOrderItems(orderItemIds)` answers the stock allocations still held for the given order items, as `{ orderItemId, warehouseId, quantity }`.
- `CreditLimitReadPort.activeReservationsForOrders(orderIds)` answers the credit reservations still active for the given orders, as `{ orderId, amount, currency }`, with `amount` the decimal string the reservation stores.
- `orderSchema` gains an optional `pendingEffects` array (`orderPendingEffectSchema`, type `OrderPendingEffect`; the closed set of effects is `ORDER_TRANSITION_EFFECTS`). It is carried by the admin order responses only, and only while a stock or credit release of the order is outstanding.

Nothing existing changes shape, so a caller of either port and a consumer of the order response need no change.

**If you implement `InventoryStockReadPort` or `CreditLimitReadPort` yourself** — a test double, or an alternative owner of the port — this is a compile break: add the new method. An implementation with nothing to report answers `[]`.
