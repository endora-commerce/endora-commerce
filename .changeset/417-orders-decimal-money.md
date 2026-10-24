---
'@endora-commerce/mod-orders': minor
---

Orders compute every amount in exact decimal arithmetic (issue #417). The rules are unchanged; only the rounding is.

- **Placement, the checkout preview and the admin preview** share one computation, `orderTotalsMoney` (new, `services/order-money.ts`): the subtotal is the sum of the lines' nets; the tax is the sum of the lines' **exact** taxes, rounded half-up once; delivery, the payment surcharge and the discount are added on the gross; the total is rounded once. On doubles, 0.70 at 5 % taxed 0.03 instead of 0.04.
- **An order line's `lineTotal` (its gross)** is `orderLineMoney(...).gross`: `net × (1 + rate)` rounded half-up on the exact product. `(29.5 * 1.23).toFixed(2)` stored 36.28 instead of 36.29.
- **`OrderReturnContextPort`** answers `paidUnitAmount` and `paidLineAmount` from `paidAmounts(...)`: the paid unit gross, half-up, times the quantity (16.50 at 23 % was 20.29 a unit, now 20.30).
- The channel minimum-order-value gate compares exactly; the payment opened at placement, the proforma, the credit refusal and the on-behalf audit carry the stored two-place total.
- The admin section summaries (`orderSectionTotals`) compute the same way and accept a net or gross as a decimal string.
- Orders already placed are not rewritten.
