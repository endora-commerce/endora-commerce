---
'@endora-commerce/mod-invoices': minor
---

Invoices take VAT per rate on the sum of the nets at that rate, rounded half-up once, with gross = net + VAT (owner ruling of 2026-10-24, issue #417; `vatByRate`). This replaces a rate's VAT as the sum of its lines' rounded grosses minus their nets: three 0.02 lines at 23 % now carry 0.01 VAT, not 0.00. A line's stored `grossValue` is informational — its share of its rate's VAT added to its net — and the line grosses add up to the invoice gross; the per-line net is unchanged. A correction applies the same method: per rate, the net the credited gross came from (`netForGrossAtRate`) and the VAT on it, so a return refunded at what the invoice charged credits exactly the invoiced net and VAT. An invoice issued before this release is shown with the rule it was issued under (new `readModelVatSummary`); `summarizeVat` and `vatSummaryRows` are removed.
