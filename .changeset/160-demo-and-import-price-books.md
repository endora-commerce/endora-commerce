---
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-import-export': minor
'@endora-commerce/demo-composition': minor
---

Feature 160 (D-287 P1) on the edges of pricing.

- **customer_accounts** — demo data of its own: the *VIP* customer group (code `demo-vip`) of the owner's E3 pricing scenario; `demo reset` withdraws it by its code.
- **import_export** — the products import refuses a file carrying a `default_price`, `defaultPrice`, `price`, `price_override` or `priceOverride` column with `400 PRICE_SET_IN_PRICE_BOOKS` and imports nothing: a product has no price of its own, so the column would otherwise be dropped without a word. Adapters may declare such columns with the new `refusedHeader`.
- **demo-composition** — the price-list backfill step (`DefaultPriceListMigrator` over each product's `defaultPrice`) is replaced by *base prices and price books over the demo catalogue*, which calls `price_lists`' `seedDemoPriceBooks` with the demo's ids, and *demo organisation joins the VIP customer group*; the `color` attribute is flagged as a price-rule attribute.
