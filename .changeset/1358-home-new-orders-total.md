---
'@endora-commerce/admin-shell': patch
---

The home page's new-orders tile now shows how many orders have the `new` status. It asks the admin orders list for one row (`pageSize=1`) and reads `pagination.total`. Before, it counted the rows on the page it got back, so it never showed more than 25.
