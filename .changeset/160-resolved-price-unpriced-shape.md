---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-price-lists': patch
---

`resolvedPriceEngineSchema` describes what `GET /api/v1/storefront/products/:id/resolved-price` answers (feature 160, FR-018).

- **`@endora-commerce/contracts`.** Amounts are decimal strings (`{ amount: '199.0000', currency: 'PLN' }`), as the route has always sent them — the schema declared numbers. An unpriced product has `baseListId`, `basePrice` and `quantityBracket` all `null` (they were declared non-null); the three are `null` together or set together.
- **`@endora-commerce/mod-price-lists`.** The route answers `baseListId: null` for an unpriced product instead of an empty string.
