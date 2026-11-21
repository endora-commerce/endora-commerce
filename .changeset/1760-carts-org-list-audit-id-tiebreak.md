---
'@endora-commerce/mod-carts': patch
---

The organization carts list (`GET /api/v1/organization/carts`) and a cart's admin audit feed (`GET /api/v1/admin/carts/:id/audit`) now order by `id` after the chosen key, so carts or entries sharing a timestamp no longer repeat or go missing across pages (#1760).
