---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': minor
---

Issue #1396: the admin cart detail now shows the gross total beside the net total.

- `GET /api/v1/admin/carts/:id` answers a new `totalGross` (`adminCartDetailPayloadSchema.totalGross`). It is what the buyer pays for the goods after the discount, the same figure as the cart read's `vat.grandTotalGross`. It is `null` when a line's VAT rate cannot be resolved. Additive: a client that does not read it is unaffected.
- The cart detail screen labels its total row **Net total** and adds a **Gross total** row when `totalGross` is known.
- No amount changes. The cart read's `grandTotal` and the admin detail's `total` stay `subtotal − discount`, never below zero: a net figure with the gross discount taken off untaxed, as the order and the invoice book it. The contract now documents this, and documents that the figure reads 0 when a fixed amount larger than the net subtotal is applied. The admin list's `total` is the lines' net before any discount.
