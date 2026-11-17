---
'@endora-commerce/mod-promotions': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-orders': patch
---

Issue #1350: percent-off and free-unit promotions now compute on the gross the buyer pays. They used to compute on net prices while the discount came off the gross total.

**Behaviour change on upgrade.** A buyer pays less than before for the same promotion. Before, "10 % off the cart" at 23 % VAT took about 8.1 % off what the buyer paid, and a "free" unit still cost its VAT. Now 10 % off is 10 % of the goods gross, and a free unit is free VAT included. Fixed-amount promotions take off the same amount as before. Orders placed before the upgrade are not changed.

- `percentage_off_cart`, `buy_x_units_percent_off`, `spend_x_percent_off`, `every_nth_product_percent_off` and the legacy `percentage_off` kind take their percentage of the gross. The gross is VAT per rate on the sum of the line nets (`vatByRate`), the same figure the cart and the order charge.
- `buy_x_get_y_free` and `buy_x_units_y_free` take off the free units' gross. They also pick the cheapest or most expensive unit by its gross price, which only differs from before in a cart that mixes VAT rates.
- Unchanged: `amount_off_cart`, `buy_x_units_amount_off`, `spend_x_amount_off`, the legacy `amount_off` kind and `free_delivery`. They take the same amount, still capped at the net subtotal. The "spend X" steps, `minCartSubtotal` and the rule builder's cart total still compare the net subtotal.
- `CartLine` (`cartLineSchema`, the line of `CartSnapshot`) gains an optional `taxRate`, the line's VAT rate as a fraction (`0.23`). A line without it carries no VAT, so its gross is its net. The cart read, the admin cart detail, the checkout preview and order placement all pass the rates they charge, so all four show the same discount. A caller of `POST /api/v1/admin/promotions/preview` must send `taxRate` on each line to get the discount an order would take.
- `PromotionApplication.total` is now the goods gross left after the discount plus the delivery left. `subtotal` stays the net subtotal.
