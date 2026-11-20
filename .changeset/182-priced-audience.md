---
"@endora-commerce/platform": minor
"@endora-commerce/contracts": minor
"@endora-commerce/mod-catalog": minor
"@endora-commerce/mod-search": minor
"@endora-commerce/mod-comparisons": minor
"@endora-commerce/mod-price-lists": minor
---

Pricing can name an Organization other than the viewer's. `@endora-commerce/platform/http` exports `pricedAudienceOf(request)` and `providePricingSubjectResolver(resolver)` (type `PricingSubjectResolver`): without a contributed resolver `pricedAudienceOf` equals `productAudienceOf`; with one it adds `ProductAudience.pricingOrganizationId`, which visibility never reads. `ListingPriceViewerContext` gains an optional `displayModeOrganization`, so the price display mode can be resolved for the viewer while the price is resolved for another Organization. The catalogue listing and product page, cross-sell tiles, search hits and type-ahead, comparisons and the storefront resolved-price and display-mode endpoints now price for `pricingOrganizationId ?? organizationId` and resolve the display mode for the viewer. Nothing changes for a request no resolver names a pricing subject for; no new cache key is introduced.
