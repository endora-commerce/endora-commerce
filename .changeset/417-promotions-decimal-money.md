---
'@endora-commerce/mod-promotions': patch
---

Discounts are computed in exact decimal arithmetic (issue #417). Every percentage — `percentage_off_cart`, `spend_x_percent_off`, `buy_x_units_percent_off`, `every_nth_product_percent_off` and the legacy `percentage_off` kind — is taken half-up on the exact product: 10 % of 1.45 was 0.14, now 0.15. "For every X spent" counts whole steps on the exact quotient (`wholeMultiples`): 0.30 held two 0.10 steps on doubles, now three. `round2` rounds half-up on the value's decimal digits, and the cart subtotal and the stored redemption amount are exact.
