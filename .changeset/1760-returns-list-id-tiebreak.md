---
'@endora-commerce/mod-returns': patch
---

The admin returns list (`GET /api/v1/admin/returns`) now orders both its sorts by `id` after the chosen key, so cases filed at the same instant no longer repeat or go missing across pages (#1760).
