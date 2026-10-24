---
'@endora-commerce/mod-carts': patch
---

Cart amounts are computed in exact decimal arithmetic (issue #417): a line's `lineTotal`, the `subtotal` and the `grandTotal` of the cart view and the mini cart, the admin and organization cart totals, and the coupon minimum-spend check and its `shortfall`. On doubles, 3 × 9.05 was published as `27.150000000000002`, and a subtotal a binary residue below a coupon's minimum dropped the coupon. Each amount is still a number, now always the two-place decimal itself. New `services/cart-money.ts` (`cartLineAmount`, `cartSubtotal`, `cartTotalAfterDiscount`, `cartShortfall`).
