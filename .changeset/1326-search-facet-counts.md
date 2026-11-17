---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-search': minor
'@endora-commerce/mod-catalog': minor
---

Storefront search filters now count the search results, not the whole catalog (issue #1326). Before, a search with no results still showed counts such as "Color (40)".

- `GET /api/v1/catalog/filters` accepts `q`. With `q`, each option count covers only the products that text query matches, and an empty result returns no filters. The matching products are the same ones `GET /api/v1/catalog/products?q` lists: from the search index when it answers the listing, from the database text match when the listing falls back to it. Counts are still computed in the database, over the products the caller may see. Without `q` nothing changes.
- `CatalogQueryService.getFilterDefinitions(ctx, narrowing?)` takes an optional `FilterNarrowing` (`{ q }` or `{ ids }`; `ids: []` means no products).
- **Breaking change** for anyone who implements `SearchQueryPort` outside this repository: the port has a new required method, `matchingProductIds({ q }, ctx)`. It returns `{ status: 'ok', ids }` (at most `SEARCH_MATCHING_IDS_MAX`, 1000, in relevance order) or `{ status: 'index-unavailable', reason }`. **What to do:** add the method, applying the same filter as your `listProducts` for the same `q`. Callers of the port need no change.
