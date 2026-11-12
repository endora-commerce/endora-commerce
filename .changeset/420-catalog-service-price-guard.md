---
'@endora-commerce/mod-catalog': patch
---

`CatalogQueryService.listProducts` now refuses a price sort or a price range (`minPrice` /
`maxPrice`) with `400 PRICE_ORDERING_UNAVAILABLE` when the viewer's page-level display mode is
`none`, before it reads anything (issue #420). The public route already refused it; the service
now holds the rule itself, so a caller that skips the route cannot narrow a price range step by
step to infer prices the page withholds.
