---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quick-order': patch
---

Admin order creation, one-click buy and the external order intake no longer empty and close the
customer's active basket (issue #169). They place the order from a separate **working basket**
written from the request's lines, through the same `placeOrder`; the customer's basket — one
filled from an accepted quote request included — is left exactly as it was, whether the order is
placed or refused.

- **`@endora-commerce/contracts`** — `CartWritePort.addItems`' option `replaceExisting` is
  replaced by `workingBasket`. Old: `addItems(actor, lines, { onLineError: 'throw', replaceExisting: true })`
  emptied the active basket and wrote the lines into it. New:
  `addItems(actor, lines, { onLineError: 'throw', workingBasket: true })` writes them into a new
  cart in status `working` and returns it; the active basket is not touched. Pass the returned
  `cart.id` as `OrderPlacementPort.placeOrder`'s new option `workingBasketId` to place from it.
  `cartStatusSchema` gains `'working'`.
- **`@endora-commerce/mod-carts`** — migration `cart_status_working` widens `carts_status_check`
  to `working`. `CartPlacementApplyPort` gains `readWorkingForPlacement(em, ctx & { cartId })` and
  `discardWorkingBasket({ cartId, customerAccountId })`; an implementation of the port has to
  provide both. A working basket ends `completed` with `completed_order_id` set, or is deleted
  when the placement is refused; it is never listed (admin carts list, organization carts list,
  the customer's carts panel) and never swept.
- **`@endora-commerce/mod-orders`** — `OrderService.placeOrder` accepts `workingBasketId`; admin
  order creation and the external intake place from a working basket.
- **`@endora-commerce/mod-quick-order`** — one-click buy places from a working basket.
