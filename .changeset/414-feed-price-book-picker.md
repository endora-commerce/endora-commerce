---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-product-feeds': minor
'@endora-commerce/mod-price-lists': patch
---

Issue #414 — a product feed can now be pinned to a price book in the Admin UI. The *Prices* section of a feed's *Settings* tab carries a *Price book* picker: *No price book* (catalogue prices), then the price books in the feed's currency that would publish for the feed now, then — disabled, with the reason beside the name — the ones that would not (not active, outside its dates, not on the feed's sales channel, not for everyone). The book the feed is already pinned to stays selectable whatever its state, its reason is stated under the field, and saving the other settings no longer resends an unchanged pin, so a pin to a deleted book does not block them.

- **`@endora-commerce/contracts`** adds `productFeedPriceBookOptionSchema` (`id`, `name`, `isBase`, `unpublishableReason` — a `pinnedPriceBookUnpublishableReasonSchema` value or `null`), its type `ProductFeedPriceBookOption`, and `productFeedPriceBookOptionsResponseSchema`.
- **`@endora-commerce/mod-product-feeds`** adds `GET /api/v1/admin/product-feeds/:id/price-book-options`, gated on `product_feeds:read` and `price_lists:read`: every book in the feed's currency plus the pinned one whatever its currency, each with the answer `namedListPublishability` gives for the feed's channel and currency. Without `price_lists:read` the picker is shown disabled and says which permission it needs. The *pinned book no longer exists* warning now points at the Settings tab instead of the API.
- **`@endora-commerce/mod-price-lists`** — its documentation no longer says a feed can be pinned only through the API.

Additive; no migration.
