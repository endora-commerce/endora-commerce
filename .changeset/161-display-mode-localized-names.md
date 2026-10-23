---
'@endora-commerce/mod-price-lists': patch
---

The display-mode page names category and product overrides in the admin language. `GET /api/v1/admin/price-books/targets/categories` and `GET /api/v1/admin/catalog/products` answer `name` as a map keyed by language tag; the page rendered the map itself, which failed for either scope. It now picks the name as the other admin surfaces do (the admin language's tag, then `en-US`, then any, then the slug or SKU), in the table and in the *Add override* dialog.
