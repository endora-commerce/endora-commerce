---
'@endora-commerce/mod-promotions': patch
'@endora-commerce/contracts': minor
---

Promotions sum and scale amounts exactly everywhere (issue #417, review of PR #423): the cart subtotal and a line-scoped base (`linesSubtotal`) are exact sums — 10 % of 0.01 + 2.34 is 0.24, not 0.23 — `spend_x_percent_off` multiplies its steps by the percentage exactly (3 × 0.15 % of 10.00 is 0.05, not 0.04), and the free-unit actions sum unit prices exactly (`unitsTotal`). The dead `cartSubtotal` helper is removed.

A promotion's typed money amounts refuse more than two decimal places with `400 AMOUNT_PRECISION_EXCEEDED` (`@endora-commerce/contracts`): the action `amount` and `spendStep`, the legacy `value` of an `amount_off` promotion (a percentage is left alone) and `minCartSubtotal`.
