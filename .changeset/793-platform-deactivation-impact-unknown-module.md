---
'@endora-commerce/platform': minor
---

`GET /api/v1/admin/modules/:id/deactivation-impact` answers `404 MODULE_NOT_FOUND` for a module id neither the registry nor a manifest knows, as the activation write does. It answered `500` before: the id reached the response schema, whose module-id pattern refused it (issue #793).
