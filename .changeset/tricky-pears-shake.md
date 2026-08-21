---
'@b2b/contracts': minor
---

Order and filter a product listing by the viewer's own price.

`productListQuerySchema` accepts two further orderings — `price` (cheapest
first) and `-price` — and two optional bounds, `minPrice` and `maxPrice`, on the
viewer's own resolved unit price. A minimum above a maximum is refused by the
schema rather than answered with an empty page. The sort union is exported on
its own as `productListSortSchema` / `ProductListSort`, with an `isPriceSort`
narrowing, so a consumer no longer has to spell the four members inline.

The listing response gains `capabilities: { priceOrdering }`, which says whether
this page may be ordered by price for this viewer at all — a non-public sales
channel publishes no prices, and `pricing.unauthenticated_display_mode = none`
hides them until login. A storefront should gate its price controls on that flag
rather than guessing.

`ListingPriceOrderPort` is published beside `ListingPricePort` on the
`pricingService` container: the catalogue in resolved-unit-price order, one
chunk at a time, for one viewer. Two new error codes,
`PRICE_ORDERING_UNAVAILABLE` and `PRICE_RANGE_INVALID`.

All additive: an existing request that omits the new fields behaves as it did,
and no existing enum member or field changed shape.
