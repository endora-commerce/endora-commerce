---
'@endora-commerce/contracts': minor
---

Two read methods, one optional response field and one partial-response schema, for order transitions that record what they owe.

- `InventoryStockReadPort.unreleasedAllocationsForOrderItems(orderItemIds)` answers the stock allocations still held for the given order items, as `{ orderItemId, warehouseId, quantity }`.
- `CreditLimitReadPort.activeReservationsForOrders(orderIds)` answers the credit reservations still active for the given orders, as `{ orderId, amount, currency }`, with `amount` the decimal string the reservation stores.
- `orderSchema` gains an optional `pendingEffects` array (`orderPendingEffectSchema`, type `OrderPendingEffect`; the closed set of effects is `ORDER_TRANSITION_EFFECTS`). It is carried by the admin order responses only, and only while a stock or credit release of the order is outstanding.

- `orderCommittedWritePartialSchema` and `orderCommittedWritePartialResponseSchema` (types `OrderCommittedWritePartial`, `OrderCommittedWritePartialResponse`) describe what `POST /api/v1/admin/orders/:id/status`, `POST /api/v1/admin/orders/:id/payment-status` and `POST /api/v1/orders/:id/cancel` answer when the change committed but the order could not be read back for the response: `{ data: { id, businessId, status, paymentStatus }, meta: { partial: true } }`. **A client of those three routes should check `meta?.partial` before treating `data` as an order** — the partial body does not parse with `orderSchema`.

Nothing existing changes shape, so a caller of either port and a consumer of the order response need no change.

**If you implement `InventoryStockReadPort` or `CreditLimitReadPort` yourself** — a test double, or an alternative owner of the port — this is a compile break: add the new method. An implementation with nothing to report answers `[]`.
