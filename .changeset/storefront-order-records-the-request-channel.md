---
'@endora-commerce/mod-orders': minor
'@endora-commerce/contracts': patch
---

A storefront order is recorded on the sales channel the request was made on.

`POST /api/v1/orders` took the order's channel from the optional `salesChannelId` body field and
fell back to the system-default channel, ignoring the channel the request itself resolved. A
request that named its channel with `X-Sales-Channel`, as every other storefront request does, was
therefore recorded on the default channel. The route now places the order on the channel the
request resolved (`X-Sales-Channel`, `?salesChannel=`, the host map, else the system default).

**The body field no longer chooses the channel.** Omitted, or equal to the resolved channel's id
(in either letter case), the request is accepted as before. Naming a different channel — another
one, one that does not exist, or one that is switched off — is refused with
`422 VALIDATION_FAILED` and `details.code = "order_sales_channel_mismatch"`
(`requestedSalesChannelId`, `resolvedSalesChannelId`), before anything is written. A client that
sends `salesChannelId` should stop sending it and name its channel in `X-Sales-Channel`.

**What changes on an instance with more than one sales channel.** New orders placed on a
non-default channel's storefront record that channel instead of the default one, and everything
read from an order's channel follows:

- at placement: the minimum order value (`orders.min_order_value`), the candidate warehouses and
  the channel's fulfilment settings, the order-number prefix and suffix, and the extra
  confirmation recipients (`orders.confirmation_recipients`);
- afterwards: the seller details and the number sequence of the order's invoices, the language and
  channel of its order, payment and shipment e-mails, whether it may be reordered
  (`orders.reorder_enabled`), and where it appears in the admin order list, per-channel reports and
  the channel's attribution count.

Existing orders are not rewritten.

**What changes on an instance with one sales channel.** One setting. A storefront order used to
reach the minimum-order-value check with no channel at all, and a setting read with no channel
answers its platform-wide value. It now arrives with the default channel's id, so a minimum order
value (`orders.min_order_value`) set **for the default channel** — rather than for all channels —
is enforced at checkout where it was not before. An instance that set it platform-wide, or not at
all, sees no change. (The warehouses, the fulfilment settings and the order numbering were already
read for the default channel on such an order.)

**For authors of payment and shipping adapters.** `validateUseOnStorefront` (and `validateUseOnAdmin`
for an impersonated checkout) now receives the order's channel id in `salesChannelId` on a
storefront placement, where it received `null`. An adapter that treated `null` as "no channel
configuration applies" will be asked about the real channel.

**What is not reconciled, and is unchanged.** A basket is still created on the system-default
channel whatever channel the buyer is shopping, and three things are still answered for the
basket's channel rather than for the order's:

- **assortment** — a product is checked against the channel of the request that added it to the
  basket, not against the order's channel, so an order can be recorded on a channel that does not
  sell one of its products;
- **line prices** — resolved for the basket's channel;
- **promotions** — evaluated for the basket's channel, at checkout exactly as in the cart, so a
  promotion restricted to a non-default channel does not yet apply to an order placed there.

Until this change the order was recorded on the default channel too, so the three agreed with it;
they can now differ from the order's channel on a multi-channel instance.

**What this is not.** It makes an order's channel the request's channel; it does not bind a buyer
to a channel. `X-Sales-Channel` and `?salesChannel=` are sent by whoever makes the request, and nothing restricts
which channels a customer or an Organization may order on.

Unchanged: admin order creation records the channel the operator chose, the API-key order intake
records the key's bound channel, and one-click buy already used the resolved channel on the
backend.
