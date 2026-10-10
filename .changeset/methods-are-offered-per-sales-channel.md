---
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/mod-payment-methods': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': minor
---

Delivery and payment methods are offered per sales channel, and the choice is enforced.

The admin API already stored a channel assignment for each method, but nothing read it: the
storefront listed every active method on every channel, the two admin screens offered no way to
choose channels, and an order could be placed with any active method.

**The rule.** An assignment is a restriction. A method assigned to one or more sales channels is
offered in exactly those; a method assigned to **no** channel is offered in every channel. That
differs from products on purpose — methods exist without an assignment as a matter of course (a
module that ships its own method seeds it during the instance's first setup, before the default
channel exists, and demo data assigns none), so "none" cannot mean "nowhere".

**Upgrade note for an instance with more than one sales channel: review every method.** The new
**Sales channels** column on `/delivery-methods` and `/payment-methods` shows where each one stands.

- Assigned to the **default channel only**, and so gone from the other channels' checkouts until
  changed: every method created in the admin so far (the screens offered nothing else), and every
  method a gateway or carrier module seeded when it was installed on an instance that had already
  been started — its installation assigns the method to the default channel when that channel
  exists.
- Assigned to **no channel**, and so still offered on every channel: methods a module seeded during
  the instance's first setup, before its first start, when no default channel existed yet, and
  methods created by demo data.

Open each method and choose its channels, or untick all of them to offer it everywhere. No data is
migrated. An instance with a single sales channel is unaffected.

**A storefront must name the channel when it reads the two catalogues.** The reference storefront
read `GET /api/v1/delivery-methods` and `GET /api/v1/payment-methods` with no `X-Sales-Channel`
header; it forwards the header now, on the checkout and on the buyer's preferences page. A
storefront created by an earlier release has the same omission in `lib/api/methods.ts`
(`listDeliveryMethods` and `listPaymentMethods` take the request context as a required argument
now) and, until it is changed, is answered with the default channel's methods on every channel;
the steps are in *Upgrading an instance*.

What changed, by package:

- **`mod-delivery-methods`, `mod-payment-methods`** — `GET /api/v1/delivery-methods` and
  `GET /api/v1/payment-methods` list only the methods offered in the sales channel the request
  resolved. Both admin screens gain a **Sales channels** field in the form and a column in the
  list. `salesChannelIds` on `PUT /api/v1/admin/{delivery,payment}-methods/:code` now has three
  meanings: **omitted** leaves the assignment unchanged on an update and assigns a new method to
  the default channel (unchanged behaviour); **`[]`** removes every assignment, offering the method
  in every channel (it used to be ignored); a non-empty list replaces the assignment (unchanged).
  An id that names no sales channel is now refused with `400 VALIDATION_FAILED` and a
  `salesChannelIds` field error, before anything is written; it used to answer `500`. Channel
  changes made through these routes are audited with the acting administrator.
  The modules' sales-channel bridges are registered with `emptyMeansEveryChannel: true`.
- **`mod-orders`** — placing an order and previewing its total refuse a delivery or payment method
  not offered in the order's sales channel: `400 VALIDATION_FAILED` with
  `details.code` `delivery_method_not_in_sales_channel` / `payment_method_not_in_sales_channel`.
  This covers `POST /api/v1/orders`, `POST /api/v1/orders/preview-total`, one-click buy, admin
  order creation and its preview, and the API-key order intake; the last three refuse before the
  customer's basket is touched. The admin order-creation form narrows its method lists to the
  chosen channel.
- **`contracts`** — `DeliveryMethodReadPort` and `PaymentMethodReadPort` gain
  `isAvailableInChannel(id, salesChannelId): Promise<boolean>`. An implementation of either port
  outside this repository must add it.
- **`platform`** — a sales-channel bridge registration may declare `emptyMeansEveryChannel`, and
  `SalesChannelMembershipPort` gains two methods that read it:
  `filterEntityIdsAvailableInChannel(channelId, entityType, entityIds)` — the ids bound to the
  channel, plus, for a declaring type only, the ids bound to none — and
  `clearChannelsForEntity(entityType, entityId, options?)`, refused with
  `ENTITY_WOULD_HAVE_ZERO_CHANNELS` for a type that does not declare it. Products keep the
  at-least-one-channel rule. An implementation of the port outside this repository must add both.
- **`admin-kit`** — new `MethodSalesChannelsField`, `MethodSalesChannelsCell`,
  `useSalesChannelOptions` and `salesChannelIdsToSubmit` on `@endora-commerce/admin-kit/components`.
- **`mod-i18n`** — the `methodSalesChannels.*` strings of the `core` bundle, in English and Polish.
- **`mod-quick-order`** — one-click buy is not offered when the buyer's default delivery or payment
  method is not offered in the sales channel of the request:
  `GET /api/v1/quick-order/one-click/eligibility` answers `{ enabled: false, reason: "missing_defaults" }`
  there, and `POST /api/v1/quick-order/one-click` refuses with `one_click_unavailable` without
  touching the basket.
