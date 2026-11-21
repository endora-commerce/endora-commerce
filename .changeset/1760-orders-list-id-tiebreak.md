---
'@endora-commerce/mod-orders': patch
---

The admin orders list (`GET /api/v1/admin/orders`) now orders every sort by `id` after the chosen key, so orders sharing a placement time, total, status or number no longer repeat or go missing across pages (#1760).
