---
'@endora-commerce/mod-returns': minor
---

A return case's default refunds follow the one VAT method (owner ruling of 2026-10-24, issue #417; new `defaultRefunds`): the returned nets — net unit price × returned quantity — with VAT per rate on their sum, rounded once, and each line its net plus its share. A full return refunds exactly what the invoice charged for those lines (9.05 × 3 at 8 % is 29.32, where the paid unit gross × 3 was 29.31); a partial return applies the same rule to the returned quantity. `defaultRefundForQuantity` is removed.
