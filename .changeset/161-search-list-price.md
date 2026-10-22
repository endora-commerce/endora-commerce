---
'@endora-commerce/mod-search': minor
---

The Meilisearch-backed listing and the typeahead carry the list price (feature 161, G19), as the catalogue cards do (G14).

- **Search listing.** `GET /api/v1/catalog/products` served by search: each hit's `resolvedPrice` gains `listPrice: { amount, currency }` when the pricing engine answers one (`pricing.show_list_price` on and the channel's everyone price above the buyer's). Old: `resolvedPrice: { basePrice, salePrice, displayMode }`. New: the same plus the optional `listPrice`.
- **Suggestions.** `GET /api/v1/search/suggest`: a priced suggestion item gains the same optional `listPrice` beside `basePrice`, `salePrice` and `priceDisplayMode`.
