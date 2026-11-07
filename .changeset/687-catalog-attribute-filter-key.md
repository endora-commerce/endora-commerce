---
'@endora-commerce/mod-catalog': patch
---

`GET /api/v1/catalog/products` refuses a `filter[attr.<key>]` whose key does not match `ATTRIBUTE_FILTER_KEY_PATTERN` with `400 VALIDATION_FAILED`, before either listing backend sees it (issue #687). A well-shaped key that names no filterable attribute still answers `400 FILTER_NOT_ALLOWED`.
