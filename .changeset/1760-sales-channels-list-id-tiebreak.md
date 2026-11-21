---
'@endora-commerce/mod-sales-channels': patch
---

The admin sales-channel list (`GET /api/v1/admin/sales-channels`) now orders by `id` after the creation time, so channels created in the same instant no longer repeat or go missing across pages (#1760).
