---
'@endora-commerce/mod-invoices': minor
---

Invoices compute every amount in exact decimal arithmetic, and price a line at its net (issue #417).

- **A line's net is `unitPrice × quantity`.** Issuance read the order line's `lineTotal` as the net, but `orders` stores that line's **gross** there, so every VAT-payer line was taxed twice: an order line of 100.00 net at 23 % was invoiced at 123.00 net and 151.29 gross. Invoices already issued are not rewritten; one issued for a VAT-payer order before this release overstates its net, VAT and gross and needs a correction.
- **A line's gross is `net × (1 + rate)` rounded half-up on the exact decimal product** (`grossFromNetHalfUp`); rounding the double made 29.50 at 23 % the gross 36.28 instead of 36.29. The per-rate rule is unchanged: a rate's VAT is the sum of its lines' grosses minus the sum of their nets.
- **A correction** caps, shares out, backs the net out of each gross and stores the unit net price (four places) in the same arithmetic: 0.15 over 8 pieces is stored as 0.0188, not 0.0187.
- `buildInvoiceLines` returns its totals as two-place strings (`netTotal`, `taxTotal`, `grossTotal`) and each line's stored amounts under `stored`; new `summarizeVat(lines)` and `vatSummaryRows(rows)` are the summary rule issuance and the read model share; new `correctionAmounts(total, originalGross, lines)`.
