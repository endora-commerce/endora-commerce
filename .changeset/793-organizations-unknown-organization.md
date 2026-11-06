---
'@endora-commerce/mod-organizations': minor
---

`GET /api/v1/admin/organizations/:id/restrictions` and `POST /api/v1/admin/organizations/:id/vat-validations` answer `404 NOT_FOUND` for an Organization that does not exist, is soft-deleted, or whose id is not a UUID, as every other Organization route does. They answered `500` before (issue #793).
