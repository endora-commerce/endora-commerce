---
'@endora-commerce/mod-customer-accounts': patch
---

The admin customers list (`GET /api/v1/admin/customers`) now orders by `id` after the creation time when no search field is selected, so accounts created in the same instant no longer repeat or go missing across pages (#1760).
