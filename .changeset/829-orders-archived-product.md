---
'@endora-commerce/mod-orders': minor
---

An archived product now gets its own reason on the operator's order paths (issue #829):

- **`POST /api/v1/admin/orders/preview`** reports the line as `PRODUCT_ARCHIVED` on every channel, whoever may see the product. Before, it was reported as `PRODUCT_NOT_IN_SALES_CHANNEL`. The order create screen shows the line as *Archived product* / *Produkt zarchiwizowany* and keeps **Create order** blocked.
- **Behaviour change for API clients:** `POST /api/v1/admin/orders` refuses a line whose product is archived with `409 PRODUCT_ARCHIVED` ("Product is archived."), naming the archived products in `details.productIds`. Nothing is written. Before, it answered `404 PRODUCT_NOT_FOUND`. This is the answer an operator's quote request already gives. A product id that does not exist, or a soft-deleted product, still answers `404 PRODUCT_NOT_FOUND`.
