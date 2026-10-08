---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/demo-composition': patch
---

A product attribute carries a new flag, **`isPriceRule`** — whether the attribute may be used as a
price-building rule in a Price List. It is the pricing sibling of `isPromoRule` and travels the
same way: `false` by default, set on create, hot-toggled through
`PATCH /api/v1/admin/catalog/attributes/:key`, and shown as a column and a checkbox on the admin
Attributes screen.

- **`@endora-commerce/contracts`** — `createAttributeRequestSchema` and
  `updateAttributeRequestSchema` accept an optional `isPriceRule`;
  `adminAttributeResponseSchema` and `CatalogAttributeView` always carry it; `CatalogAttributeFlag`
  and `CatalogAdminAttributeFlag` gain `'isPriceRule'`, so
  `catalogAttributeReadPort.listByFlag('isPriceRule')` answers the attributes a price rule may name.
  **If you build a `CatalogAttributeView` yourself** — a test double of `CatalogAttributeReadPort`
  is the usual case — add `isPriceRule: false`; the field is required, which is why this is a
  minor in a `0.x` series.
- **`@endora-commerce/mod-catalog`** — a migration adds `product_attributes.is_price_rule`
  (`boolean not null default false`), and `GET /api/v1/admin/catalog/attributes/by-flag` accepts
  `flag=isPriceRule`.
- **`@endora-commerce/demo-composition`** — `createAttributeFixture` accepts `isPriceRule`.

Nothing prices from the flag yet: a Price List's application rule still matches on sales channel,
customer group, organization, category and currency only. This release records the flag and
publishes it for the price-rule work to consume.
