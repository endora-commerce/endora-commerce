---
'@endora-commerce/mod-orders': patch
---

`POST /api/v1/admin/orders/preview` reports a soft-deleted product as `PRODUCT_NOT_FOUND` on every channel (issue #820). It used to report `PRODUCT_NOT_IN_SALES_CHANNEL` on a channel that still listed the product. The preview now reads products with `liveOnly`. A soft-deleted product has been unavailable everywhere since feature 163, and `POST /api/v1/admin/orders` refuses it with `404 PRODUCT_NOT_FOUND`, so the preview now gives the same answer as create. Other lines in the same preview are priced as before.
