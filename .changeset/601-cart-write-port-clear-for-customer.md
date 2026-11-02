---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': minor
---

**Breaking:** `CartWritePort.clearForCustomer(ctx)` is removed from the published cart write port (`@endora-commerce/contracts`), and with it the adapter's `clearForCustomer` and `CartService.clearForCustomer` in the `carts` module. It deleted every line of the customer's active basket and marked the basket `completed` without an order, which reads as a finished basket that produced nothing (the defect issue #169 fixed); since #169 no code of the platform calls it.

A module that called it does one of these instead:

- **To place an order for a customer**, write the lines into a working basket — `const basket = await cartWritePort.addItems({ customer }, lines, { onLineError: 'throw', workingBasket: true })` — and place from it with `orderPlacementPort.placeOrder(ctx, request, { workingBasketId: basket.cart.id })`. The customer's active basket is not touched.
- **To replace what is in the customer's basket**, call `cartWritePort.replaceItemsForCustomer(ctx, lines)`; the basket stays active. `replaceItemsForCustomer(ctx, [])` leaves it active and empty.

A test that reset a buyer's basket with `clearForCustomer` needs a fixture of its own; the platform's tests delete the basket row (`delete from "carts" where "customer_account_id" = ? and "sales_channel_id" = ? and "status" = 'active'`, lines and audit entries cascade).
