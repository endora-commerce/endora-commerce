---
'@endora-commerce/mod-promotions': minor
'@endora-commerce/mod-carts': patch
'@endora-commerce/contracts': patch
---

Issue #1396: promotion thresholds and fixed-amount caps now use the gross the buyer pays. They used to use the net subtotal, while percent-off discounts already used the gross (#1350).

**Behaviour change on upgrade.** Some promotions now apply to carts they skipped before, and some fixed amounts take off more. A minimum spend of 500 used to need 500 net; now it needs 500 gross. A fixed amount used to stop at the net subtotal, so 150 off a cart of 100 net / 123 gross left the buyer paying 23. Now it can make the goods free, VAT included. Orders placed before the upgrade are not changed.

- `minCartSubtotal`, the rule builder's `cartTotal` and the "spend X" steps of `spend_x_percent_off` and `spend_x_amount_off` compare the goods gross before any discount. The gross is VAT per rate on the sum of the line nets (`vatByRate`).
- `amount_off_cart`, `buy_x_units_amount_off`, `spend_x_amount_off` and the legacy `amount_off` kind are capped at the gross.
- Applying a coupon (`POST /api/v1/cart/coupon`) and re-checking it on the cart read compare its minimum spend with the gross, at the rates the cart read and order placement charge. A coupon refused with `below_min_spend` reports a gross `shortfall`.
- An operator who set a minimum spend or a "spend X" step as a net amount should review it: the same figure is now reached by a smaller net basket.
