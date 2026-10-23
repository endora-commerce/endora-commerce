---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/mod-product-feeds': minor
---

A product feed pinned to a price book publishes the book's prices only while the book applies to an anonymous buyer on the feed's channel (feature 160, FR-029, owner ruling 2026-10-23).

- **`@endora-commerce/contracts`.** New `pinnedPriceBookUnpublishableReasonSchema` (`not_found`, `currency_mismatch`, `not_active`, `outside_schedule`, `not_on_channel`, `audience_restricted`) and the `PinnedPriceBookPublishability` type. `productFeedSchema` gains `pinnedPriceBookWarning` (the reason, or `null`).
- **`@endora-commerce/mod-price-lists`.** `pricingService.namedListPrices` answers nothing unless the book is `active` or `scheduled` inside its schedule window, bound to the feed's channel with the channel offering its currency (a base book is channel-independent) and for everyone; before, it ignored status, dates, channel and audience. New `pricingService.namedListPublishability({ priceListId, currencyCode, salesChannelId })` says whether, and why not. The catalogue price a pinned book's percentage and amount rows are taken off is now the channel's catalogue price **without** that book (an everyone book was taken off its own result).
- **`@endora-commerce/mod-product-feeds`.** `NamedListPricePort` requires `namedListPublishability`; the admin feed list and detail rows carry `pinnedPriceBookWarning`, and the feed page shows it as a warning (English and Polish). A run of such a feed gets no prices from the book, so its items are skipped with `missing_price` as for any unpriced product.
