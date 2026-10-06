---
'@endora-commerce/mod-orders': minor
---

Two additive seams for other modules; an instance in which nobody uses them behaves as before.

- **An opaque `origin` on an administrator-created order.** `POST /api/v1/admin/orders`
  accepts an optional `origin: { type, id }` and echoes it, unread, on `order.created.v1`. The
  key is absent from the event when the request carried none, so an existing subscriber sees
  the payload it always saw. For an order created with one, an outbound webhook subscribed to
  `order.created.v1` receives it too, since the webhook's payload is the event's. The value is
  not stored, not returned and not interpreted, and a storefront placement cannot set it.
  `OrderService.placeOrder` takes an optional third argument `{ origin? }`;
  `OrderPlacementPort` is unchanged.
- **The create-order screen (`/orders/new`) can be opened by another screen**: it reads
  `originType`, `originId`, `organizationId`, `customerAccountId`, `salesChannelId` and
  `returnTo` from its query string. Opened without them it behaves as before.
- **A new admin zone, `order.detail.after`**, mounted once at the end of the order screen,
  below its tabs, with `{ orderId }`. The module names no contributor; with nothing
  contributed the screen is unchanged.
