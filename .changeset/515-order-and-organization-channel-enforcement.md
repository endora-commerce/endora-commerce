---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-i18n': minor
---

**BREAKING — `POST /api/v1/admin/orders` and `POST /api/v1/admin/orders/preview` for a sales channel that is not one of the customer's Organization's active assigned channels now answer `422 ORDER_SALES_CHANNEL_NOT_ALLOWED`: a channel the Organization is not assigned to, or an inactive one, where they answered `201` / `200`, and a channel id that does not exist, where they answered `404 NOT_FOUND`. `GET` and `PUT /api/v1/admin/organizations/:id/sales-channels` for an Organization outside a sales representative's reach now answer `404 NOT_FOUND` where they answered `200`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range (issue #515).

An order an operator creates on a customer's behalf is placed only on one of the customer's Organization's active assigned channels — the rule a quote request created on a customer's behalf has followed since the product data scopes release. The refusal comes before anything is written: no working basket, no inline address, no order. The order's `salesChannelId` stays required, so there is no defaulted channel to check; a request without it is still `400 VALIDATION_FAILED`.

- `@endora-commerce/contracts`: `ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED`, declared by `orders` with an English and a Polish sentence.
- `@endora-commerce/mod-orders`: `OrderCreationAdminService` takes the Organization channel read (`SalesChannelMembershipPort.listChannelsForEntity`) as a new sixth constructor argument, before `mailer`; composed without it, `create` fails closed with `500 INTERNAL`, as the preview already did. The *Create order* screen offers the customer's Organization's active channels, read from `GET /api/v1/admin/organizations/:id/sales-channels` — the only one preselected, else a choice; a `salesChannelId` in the link kept only when it is one of them; a notice and a retry when the Organization has none or they cannot be read — instead of every active channel.
- `@endora-commerce/mod-organizations`: the Organization sales-channel read and replace apply the request's tenant scope. A platform administrator reaches every Organization, as before; a sales representative only the ones assigned to them. The response shape is unchanged.
- `@endora-commerce/mod-i18n`: the *Create order* screen's channel notices (`orderCreate.channelsLoadError`, `orderCreate.noChannelWarning`, `orderCreate.hint.salesChannel`), in English and Polish.

An instance whose operators create orders on channels their customers' Organizations are not assigned to will see those requests refused once it upgrades: assign the Organization to the channel first (the Organization's *Sales channels* panel), or create the order on one of its channels.
