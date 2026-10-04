---
'@endora-commerce/mod-credit-limits': minor
---

`creditLimitReadPort` answers which orders still hold credit.

The module's implementation of `CreditLimitReadPort` gains `activeReservationsForOrders(orderIds)`: the reservations with `status = 'active'` for the given orders, as `{ orderId, amount, currency }`. `orders`' repair command uses it to list cancelled or paid orders that still hold credit before releasing anything. An empty input answers `[]` without a query.

`releaseByOrder` is unchanged. With `credit_limits` switched off, an order placed on credit can now be cancelled or marked paid, and its reservation is released once the module is switched back on; placing a new order against a credit limit is still refused while the module is off.
