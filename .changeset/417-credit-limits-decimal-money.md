---
'@endora-commerce/mod-credit-limits': patch
---

Credit limits decide and report in exact decimal arithmetic (issue #417). A reservation compares the order total with `granted − Σ active reservations` exactly: on doubles a 0.30 limit with 0.10 reserved had 0.19999999999999998 available and refused a 0.20 order as `LIMIT_INSUFFICIENT`. The granted, adjusted, topped-up and reserved amounts are stored half-up on their decimal digits (`1.005` is `1.01`, not `1.00`), and `availableAmount` / `availableAmountAfter` in every answer is the two-place decimal. New `services/credit-money.ts` (`availableCredit`, `coversAmount`, `creditAmount`).
