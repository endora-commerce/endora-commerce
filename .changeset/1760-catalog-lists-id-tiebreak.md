---
'@endora-commerce/mod-catalog': patch
---

The admin products list (`GET /api/v1/admin/catalog/products`, with and without a search), the batch-by-id read and the bulk-operations history now order by `id` after the creation time, so rows created in the same instant no longer repeat or go missing across pages (#1760).
