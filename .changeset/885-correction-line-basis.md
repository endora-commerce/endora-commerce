---
'@endora-commerce/contracts': minor
---

`CorrectiveInvoiceLine` gains an optional `basis` (`CORRECTION_LINE_BASES`, type
`CorrectionLineBasis`): `returned_goods`, the default when absent, or `price_reduction`, a
complaint settled with money where the buyer keeps the goods (issue #885).
`CorrectiveInvoiceInput` gains an optional `caseReference`, the case's RMA number, which names a
price-reduction line. The JSDoc of `invoiceLineSchema.quantity` states the convention an integration
reads back: on a correction, a goods line with quantity 0 is a price reduction. Both fields are
additive; a caller that sends neither is corrected as before.
