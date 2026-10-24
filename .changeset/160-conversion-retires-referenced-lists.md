---
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': minor
---

The upgrade to price books no longer stops on a product feed pinned to an old-model price list.

- **`@endora-commerce/mod-price-lists`.** The conversion migration deletes the old-model lists one at a time. A list another table still refers to (on 0.107.0, a product feed pinned to it) is **retired** instead of deleted: it keeps its id, loses its rows, audience, channel bindings and dates, becomes `expired` and for everyone, and is renamed "… (removed by the 0.108.0 upgrade)". Before, the conversion failed on the feed's foreign key and the whole upgrade rolled back.
- **`@endora-commerce/mod-product-feeds`.** New migration `20261023T234605_product_feeds_price_list_fk_dropped` drops `product_feeds_price_list_fk`: a price book a feed is pinned to can now be deleted. The feed then warns `not_found` and its next run withdraws its published file; a new pin is still checked against the price books when it is written. After the upgrade a feed pinned to a retired list warns `not_active`, and its next run withdraws its file until it is pinned to a price book that applies, or unpinned, through the product feeds API (`PATCH …/product-feeds/:id`, `priceListId`).
