---
'@endora-commerce/mod-newsletter': patch
---

The admin subscribers list (`GET /api/v1/admin/newsletter/subscribers`) now orders by `id` after the creation time, so subscribers created in the same instant no longer repeat or go missing across pages (#1760).
