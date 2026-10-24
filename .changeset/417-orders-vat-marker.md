---
'@endora-commerce/mod-orders': minor
'@endora-commerce/contracts': minor
---

Orders record the VAT method they were placed under, and report what an order charged from what it stored (issue #417, review of PR #423, owner ruling of 2026-10-24).

- New nullable column `orders.vat_method` (migration `Migration20261024T145147OrdersVatMethod`, no backfill): placement writes `per_rate`; `null` is an order placed before 0.108.0, whose totals followed the rule of their day.
- A new order line's stored `lineTotal` is the line's own rounding of its gross, `round(net × (1 + rate))`; the order's VAT and total are still per rate on the net sums, so the line totals may differ from the total by a cent.
- `OrderReturnContextPort` no longer recomputes what was paid: `paidLineAmount` is the stored `lineTotal`, `paidUnitAmount` that over the quantity, and `OrderReturnContext` (`@endora-commerce/contracts`) gains `vatMethod` and `productsPaidTotal` (stored subtotal + tax total). `paidAmounts` is removed.
