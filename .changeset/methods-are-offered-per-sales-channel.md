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
module that ships its own method seeds it with none, and so does demo data), so "none" cannot mean
"nowhere".

**Upgrade note for an instance with more than one sales channel: review every method.** The new
**Sales channels** column on `/delivery-methods` and `/payment-methods` shows where each one stands.

- **Created in the admin so far** — assigned to the **default channel only** (the screens offered
  nothing else), and so gone from the other channels' checkouts until changed.
- **Seeded by a gateway or carrier module under an earlier release, on an instance that had already
  been started** — also assigned to the **default channel only**: that release's seed bound the
  method to the default channel whenever it existed. They do not appear on other channels until an
  operator widens them.
- **Seeded by a module from this release on** — assigned to **no channel**, and so offered on every
  channel, whenever the module is installed. The same holds for methods a module seeded under an
  earlier release during the instance's first setup, before its first start, and for demo data.

Open each method and choose its channels, or untick all of them to offer it everywhere. No data is
migrated: a method bound to the default channel by an earlier seed cannot be told apart from one an
operator restricted on purpose, so none is widened automatically. An instance with a single sales
channel is unaffected.

**For authors of a gateway or carrier module.** `bindToDefaultChannel` is removed from
`DeliveryMethodSeedApi` and `PaymentMethodSeedApi` (`@endora-commerce/mod-delivery-methods/ports`,
`@endora-commerce/mod-payment-methods/ports`, and the seeders their `./install` subpaths create).
An install hook that called it after `ensureMethodForAdapter` must delete the call, and needs no
replacement: the seeded method is offered on every channel until an operator restricts it. Two
things follow for a module that still calls it. Its **source** no longer compiles against this
release. And a **build published earlier** does not fail at compile time at all: the seeder object
simply has no such method, so the module's install hook throws a `TypeError` the first time it
creates its method — on a new instance, or on any instance where the method's row does not exist
yet. An instance that already has the row is unaffected, because the hook only calls the bind for a
row it has just created. Such modules must therefore be re-released for this version. A module that must seed a method restricted to particular channels has
no seam for that at install; restrict it in the admin.

**Permissions.** Choosing a method's sales channels is part of configuring the method:
`delivery_methods:write` / `payment_methods:write` is sufficient to assign, replace and clear them,
and `sales_channels:write` is not required. The form reads its options from a route of the method
module itself, `GET /api/v1/admin/{delivery,payment}-methods/sales-channels`, gated on that
module's `:read` code, so an administrator who configures methods and does not administer sales
channels can use the field.

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
- **`contracts`** — new `SalesChannelOptionSchema` / `SalesChannelOption`, the shape of the two
  channel-options routes. `DeliveryMethodReadPort` and `PaymentMethodReadPort` gain
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
  `useSalesChannelOptions(path, enabled)` and `salesChannelIdsToSubmit` on
  `@endora-commerce/admin-kit/components`.
- **`mod-i18n`** — the `methodSalesChannels.*` strings of the `core` bundle, in English and Polish.
- **`mod-quick-order`** — one-click buy is not offered when the buyer's default delivery or payment
  method is not offered in the sales channel of the request:
  `GET /api/v1/quick-order/one-click/eligibility` answers `{ enabled: false, reason: "missing_defaults" }`
  there, and `POST /api/v1/quick-order/one-click` refuses with `one_click_unavailable` without
  touching the basket.
