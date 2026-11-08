---
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-i18n': patch
---

A complaint refunded or credited after the order was invoiced is now documented as a price
reduction, not as goods coming back (issue #885, product-owner ruling of 2026-11-07). The
settlement sends its lines with `basis: 'price_reduction'`, no discount and the case's RMA number.
The correction credits the approved amount at the line's VAT rate on a line stored with quantity 0
and named in the document's language, *Obniżka ceny (reklamacja RMA-…): product*
(`invoices.lines.priceReduction`, or `lines.priceReductionUnreferenced` without an RMA number). It
credits no discount, and it does not lower the quantity a later return of the line is credited
from. A complaint resolved by replacement or repair still issues no correction.

The provider refuses, before any money moves, a price-reduction line that carries a discount
(`422 VALIDATION_FAILED`, `price_reduction_carries_discount`) and a correction that credits more
goods at one VAT rate than the invoice still charges there (`422 VALIDATION_FAILED`,
`correction_exceeds_rate_remaining`, with `taxRate`, `remaining` and `vatRatePercent`; the operator
sentence is in `@endora-commerce/mod-i18n`). The `invoice.corrected` audit entry records
`priceReductionLines`.

Wire `CorrectiveInvoiceProvider`'s new last constructor argument, `{ translate, language }`, to name
the line; without it the line is named in English.

A complaint refunded before the order was invoiced is unchanged: the invoice still lists the goods
in full and shows the complaint refund as amount due.
