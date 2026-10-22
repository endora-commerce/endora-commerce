---
'@endora-commerce/mod-catalog': minor
---

Feature 161 (G14, G15) on the catalogue.

- **List price on the cards and the product page (G14).** `GET /api/v1/catalog/products` and `GET /api/v1/catalog/products/:idOrSlug` carry `resolvedPrice.listPrice: { amount, currency }` when the pricing engine answers one (`pricing.show_list_price` on and the channel's everyone price above the buyer's). Absent otherwise; nothing else in the summary changes.
- **`CatalogProductReadService.pageProductIdsByName({ ids, search?, language, offset, limit })` (G15)** — one page of the given products by shown name (the language, any tag of it, English, any name, else the SKU), then SKU, then id, with the total, in one statement; `search` matches the shown name, the SKU or a variant's SKU, literally and case-insensitively. Structural: soft-deleted products are included.
