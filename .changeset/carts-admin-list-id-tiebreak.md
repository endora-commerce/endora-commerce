---
'@endora-commerce/mod-carts': patch
---

The admin carts list (`GET /api/v1/admin/carts`) now orders every sort it offers by `id` after the chosen key, so carts sharing a last-activity, creation or update time no longer repeat or go missing across pages (#1621).
