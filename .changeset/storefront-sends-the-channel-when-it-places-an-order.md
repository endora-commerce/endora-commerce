---
'@endora-commerce/cli': patch
---

The storefront `endora new` creates tells the backend which sales channel an order is placed on.

The storefront's order calls went out with no `X-Sales-Channel` header: they are made server-side,
to the backend's own host, and did not forward the request context. Whatever channel the buyer was
shopping, the backend resolved the system default for them. The storefront now forwards the
context — and with it the header — on order placement, the order-total preview, one-click buy and
its eligibility check, and "order again as a quote request".

In `lib/api/orders.ts`, `placeOrder`, `previewOrderTotal` and `cloneOrderToQuote`,
and in `lib/api/quick-order.ts`, `placeOneClickOrder` and `getOneClickEligibility`, take the request
context as a required last argument; the checkout, order and product pages pass
`(await getServerContext()).ctx`.

A storefront that already exists keeps its source and does not receive this. It matters only on an
instance with more than one sales channel; the steps are in *Upgrading an instance*.
