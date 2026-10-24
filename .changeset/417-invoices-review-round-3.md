---
'@endora-commerce/mod-invoices': minor
---

Invoices store the summary they were issued with, record as paid what was captured, and correct cumulatively (issue #417, owner ruling and review of PR #423).

- **A line's `grossValue` is the line's own rounding**, `round(net × (1 + rate))`; the VAT and the totals stay per rate on the net sums, so the line grosses may differ from the gross total by a cent.
- **New nullable column `invoices.vat_summary`** (migration `Migration20261024T145631InvoicesVatSummary`, no backfill): issuance and a correction store the per-rate summary they were issued with, and the read model shows it. A document with none — issued before 0.108.0, or imported — is shown with the summary derived from its stored lines, as it was then. `readModelVatSummary(lines, stored)` decides by the stored summary, never by whether the totals reproduce.
- **`paidTotal` is what was paid for the order** — the paid, partially refunded and refunded payment attempts' amounts, through `payments`' `paymentReadPort` (a new `degrades-without` dependency); an order recorded as paid with nothing captured, or with `payments` absent, its stored total — never the invoice gross. An order placed before 0.108.0 that charged 40.80 and is invoiced now at 40.81 shows 0.01 as due.
- **A correction is cumulative over the corrections of one invoice**: per rate (per line for an invoice issued before 0.108.0) it credits the net of everything credited so far minus what earlier corrections credited, so all corrections together credit exactly the invoiced net and VAT; the cap is what remains of the invoice. A total above the sum of the correction's lines is refused with `400 VALIDATION_FAILED` (`details.code: correction_total_exceeds_lines`). `correctionAmounts` takes one `CorrectionInput` object.
