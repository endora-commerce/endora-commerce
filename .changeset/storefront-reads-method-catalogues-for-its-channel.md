---
'@endora-commerce/cli': patch
---

The storefront `endora new` creates asks for the delivery and payment methods of the sales channel
the buyer is shopping.

`listDeliveryMethods` and `listPaymentMethods` in `lib/api/methods.ts` called the backend with no
request context, so no `X-Sales-Channel` header was sent. They take the context as a required
argument now, and the checkout and the buyer's preferences page pass `(await getServerContext()).ctx`.

A storefront that already exists keeps its source and does not receive this. On an instance with
more than one sales channel it is then answered with the default channel's methods on every
channel; the steps are in *Upgrading an instance*.
