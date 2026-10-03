---
'@endora-commerce/mod-inventory': patch
---

Documentation: the inventory page has a proper "Public routes" table again. Two of its rows had
been left dangling after the Permissions section, the storefront display-mode route sat in the
admin table, and the anonymous `POST /api/v1/storefront/inventory/notify-when-available` route
was missing. The notify-when-available section now names which route serves signed-in customers
and which serves anonymous visitors.
