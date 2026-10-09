---
'@endora-commerce/mod-orders': minor
'@endora-commerce/contracts': patch
---

A storefront order is recorded on the sales channel the request was made on.

`POST /api/v1/orders` took the order's channel from the optional `salesChannelId` body field and
fell back to the system-default channel, ignoring the channel the request itself resolved. A
request that named its channel with `X-Sales-Channel`, as every other storefront request does, was
therefore recorded on the default channel, and a client that sent the body field could name any
channel. The route now places the order on the channel the request resolved (`X-Sales-Channel`,
`?salesChannel=`, the host map, else the system default).

**A storefront must name the channel on the placement request.** The reference storefront did not:
its order placement, order-total preview and one-click-buy calls sent no `X-Sales-Channel` at all,
so every order it placed reached the backend with no channel signal. It forwards the header on
those calls now. A storefront scaffolded from an earlier release has the same omission in
`lib/api/orders.ts` and `lib/api/quick-order.ts` and needs the same change — `placeOrder`,
`previewOrderTotal`, `placeOneClickOrder` and `getOneClickEligibility` take the request context as
a required argument.

**The body field no longer chooses the channel.** Omitted, or equal to the resolved channel's id,
the request is accepted as before. Naming a different channel is refused with
`422 VALIDATION_FAILED` and `details.code = "order_sales_channel_mismatch"`
(`requestedSalesChannelId`, `resolvedSalesChannelId`), before anything is written. A client that
sends `salesChannelId` should stop sending it, or send the channel it addresses in
`X-Sales-Channel`.

**What changes on an instance with more than one sales channel.** New orders placed on a
non-default channel's storefront record that channel instead of the default one. With the channel
go the things read from it at placement: the minimum order value (`orders.min_order_value`), the candidate
warehouses and channel-level fulfilment settings, and the order-number prefix and suffix. Those
orders also appear under their own channel in the admin order list, in per-channel reports and in
the channel's attribution count. Existing orders are not rewritten.

**An instance with one sales channel is unaffected**: the resolved channel and the default are the
same row.

Unchanged: admin order creation records the channel the operator chose, the API-key order intake
records the key's bound channel, and one-click buy already used the resolved channel. The basket's
own channel is also unchanged — it is still the system default, and promotions are still evaluated
against it at checkout as in the cart, so a promotion restricted to a non-default channel does not
yet apply to an order placed there.
