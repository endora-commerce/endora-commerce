---
'@endora-commerce/mod-inventory': patch
---

**The back-in-stock e-mail names the product as the buyer saw it.** A subscription made through `POST /api/v1/storefront/inventory/notify-when-available` or `POST /api/v1/catalog/products/:id/notify-when-available` now records the resolved sales channel of the request and the language resolved from its `Accept-Language` against that channel's languages. When the product is back in stock, the e-mail names it by its effective name at that channel and language — the channel × language name, else the channel name, else the global name — read through catalog's `catalogProductAvailabilityPort.effectiveTexts`.

- **Migration** `Migration20261115T065605InventoryAvailabilityNotificationScope` adds the nullable columns `availability_notifications.sales_channel_id` (foreign key to `sales_channels`, `on delete set null`) and `availability_notifications.language_code`. Nothing is backfilled: a subscription made before the upgrade, or whose channel is later deleted, keeps the global name it was going to get.
- Only the product name follows the subscription. The rest of the message is worded as before. Operator low-stock alerts keep the global name.
