---
'@endora-commerce/mod-orders': minor
'@endora-commerce/contracts': minor
---

Orders take VAT per rate on the sum of the nets at that rate, rounded half-up once (owner ruling of 2026-10-24, issue #417; `vatByRate`), in placement, the checkout preview and the admin preview. This replaces the sum of every line's exact tax across all rates rounded once: 29.50 at 23 % with 4.30 at 5 % now carries 7.01 VAT and a total of 40.81 — the figure the invoice carries — where it carried 7.00 and 40.80. The paid amount, the proforma, the credit reservation and the order total are that one figure. A line's stored `lineTotal` is its net plus its share of its rate's VAT, so the line totals add up to the products' gross; `orderLineMoney` is removed and `orderTotalsMoney` answers each line's amounts under `lines`.

`OrderReturnContextPort` answers `paidLineAmount` under the same method over the whole order — what the order line and the invoice charged (9.05 × 3 at 8 % is 29.32, not 29.31) — `paidUnitAmount` as that over the quantity, and two new fields on `OrderReturnContextLine` (`@endora-commerce/contracts`): `unitNetPrice` and `taxRate`, so a return prices a returned quantity under the same method.
