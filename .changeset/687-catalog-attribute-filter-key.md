---
'@endora-commerce/mod-catalog': patch
---

`GET /api/v1/catalog/products` refuses a `filter[attr.<key>]` whose key no attribute could have (`isAttributeKey`) before either listing backend sees it, with the same `400 FILTER_NOT_ALLOWED` an undeclared key already answers (issue #687).
