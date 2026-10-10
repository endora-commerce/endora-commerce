---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-inventory': patch
---

`409 STOCK_UNAVAILABLE` says which product and which quantity. The refusal's sentence was a
placeholder — "Stock Unavailable." in English and "Błąd: stock unavailable." in Polish — while the
message it replaced named only a product id, so a buyer with many lines was not told which one to
change.

The error now carries `details` — `productId`, `sku`, `productName` (the name the order line would
have snapshotted) and `requestedQuantity` — and both sentences name them: "\"Example product\"
(EXAMPLE-SIMPLE-001) is not available in the quantity ordered (5). Reduce the quantity or remove the
product from the order."

How many are left is deliberately **not** in `details`: the storefront shows an exact stock figure
only in the `exact` stock display mode, and a refusal naming the available quantity would disclose
it in the two modes that withhold it.

The code and the status are unchanged; a client matching on either sees no difference.
