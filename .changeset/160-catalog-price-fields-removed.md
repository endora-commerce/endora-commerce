---
'@endora-commerce/mod-catalog': minor
---

A product has no price of its own any more (feature 160, FR-042, FR-043): prices are rows of price books.

- **Removed, not converted.** Migration `20261022T111811_catalog_price_fields_removed` drops `product_variants.price_override` and strips the `defaultPrice` and `price` keys from `products.attribute_values`. The `ProductVariant.priceOverride` property and the `priceOverride` field of the variant DTOs, the admin variant read and `CatalogProductVariantRecord` are gone.
- **Refused.** `POST`/`PATCH /api/v1/admin/catalog/products[/:id]` naming `attributeValues.defaultPrice` or `attributeValues.price` (or either at the top level), and `POST`/`PATCH …/products/:productId/variants[/:variantId]` naming `priceOverride`, answer `400 PRICE_SET_IN_PRICE_BOOKS` and write nothing. Old: `PATCH …/products/:id` with `{ attributeValues: { defaultPrice: 49.99 } }`, or a variant with `{ priceOverride: 49.99 }`. New: `PUT /api/v1/admin/price-books/base-prices/:productId` with the product's tiers and its variants' rows, per currency.
- **Admin.** The product editor's *Default unit price* field and the variant table's *Price override* column and field are removed; the attribute-set swap no longer keeps a `defaultPrice` key.
- **Listing.** Price sort and the price range read the price surface; the unpriced tail has no `defaultPrice` arm. Listings, product detail, product links and the external catalogue API pass variants to the pricing port and render the source, compare-at and "from" prices.
- **Demo.** The catalogue demo writes no `defaultPrice`; `price_lists`' demo step prices the demo products (*Screws 0200* at 100 PLN).
