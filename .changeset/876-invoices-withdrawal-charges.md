---
'@endora-commerce/mod-invoices': minor
---

Issue #876 — invoices follow a consumer's withdrawal that refunded the delivery cost and the payment surcharge.

- `CorrectiveInvoiceProvider` credits `CorrectiveInvoiceInput.charges` on lines of their own, written with `lineKind` `delivery` / `payment_surcharge`, named and rated like the invoice line that charged them (0 % today). A charge is never credited above what that line still charges after earlier corrections. Otherwise the correction is refused `422 correction_exceeds_charge_remaining` before any money moves. A charge the invoice has no line for is refused `422 no_corrected_line`. An invoice issued before #904 has no line kinds: its delivery line is the first positive line naming no order item, and its surcharge line the second. `correctionAmounts` takes `charges` and answers `chargeLines`; `CorrectionExceedsChargeRemainingError` and `chargeLinesOf` are new.
- An invoice issued after such a settlement charges the delivery and the surcharge less what the settled returns refunded (`ReturnRefundsLookup.refundedChargesFor`, from `returnRefundReadPort.listRefundedCharges`), and leaves a line out when nothing is left. A B2C order returned and refunded in full is refused `422 INVOICE_ORDER_REFUNDED` as before.

**Behaviour change on upgrade.** On a B2C order returned in full after it was invoiced, the last correction now also credits the delivery and the surcharge, so the invoice nets to zero. Before, the delivery stayed charged. A B2C order returned in full before it was invoiced is now refused, where it used to be invoiced for the delivery alone. When the operator reduced a premium delivery, only the difference is invoiced. Documents already issued are not changed.
