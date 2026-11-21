---
'@endora-commerce/mod-admin-users': patch
---

The admin users list (`GET /api/v1/admin/admin-users`) ends its order on `id`, with and without a search, so the order is total by construction rather than by the e-mail constraint alone (#1760).
