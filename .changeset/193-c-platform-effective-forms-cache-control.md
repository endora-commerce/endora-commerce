---
'@endora-commerce/platform': patch
---

`GET /api/v1/admin/effective-forms` now answers `Cache-Control: private, no-cache` beside its `ETag` (`specs/193-admin-form-extensions/` D-300.21). A browser may keep the body but must revalidate it on every fetch, and no shared cache may hold it. The admin kit's plain GET relies on that revalidation and sets no `If-None-Match` itself.
