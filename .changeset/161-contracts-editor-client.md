---
'@endora-commerce/contracts': minor
---

Response schemas the price-book editor's client parses (feature 161, T045), additive — the routes already answered these shapes.

- **`priceBookRowsResponseSchema`** (`PriceBookRowsResponse`): `GET /api/v1/admin/price-books/:id/rows` — `{ data: PriceBookRow[], meta: { page, pageSize, totalCount } }`.
- **Picker answers** of `GET /api/v1/admin/price-books/targets/*`, each `{ data: { items } }`: `priceBookTargetOrganizationsResponseSchema` (`{ id, name, taxId }`), `priceBookTargetCustomerGroupsResponseSchema` (`{ id, code, name }`), `priceBookTargetCategoriesResponseSchema` (`{ id, slug, name: Record<language, string>, parentCategoryId, sortOrder }`), `priceBookTargetAttributesResponseSchema` (`{ key, label, valueType, options: { value, label }[] }`), `priceBookTargetSalesChannelsResponseSchema` (`{ id, code, name: Record<language, string>, currencies, defaultCurrency }`) and `priceBookTargetCurrenciesResponseSchema` (`{ code, exposedByChannels }`), with their item schemas (`priceBookTarget<Kind>Schema`) and types (`PriceBookTarget<Kind>`).
