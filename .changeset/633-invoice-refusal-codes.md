---
'@endora-commerce/mod-invoices': minor
'@endora-commerce/contracts': patch
'@endora-commerce/mod-i18n': patch
---

The business refusals of invoice issuance and of corrective invoices have error codes of their
own instead of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #633, part of #86).
**A caller that matches on `VALIDATION_FAILED`, or on the `details.code` tokens listed below, now
sees the specific code.** The HTTP status of each is unchanged. Until now each was answered with an
English sentence in every language, because the error envelope never replaces the message of
`VALIDATION_FAILED`.

| Was | Is | `details` |
| --- | --- | --- |
| `422 VALIDATION_FAILED`, *"Seller VAT/NIP and company data must be configured before issuing invoices."* | `422 INVOICE_SELLER_DATA_MISSING` | `setting` (unchanged) |
| `422 VALIDATION_FAILED`, `details.code = "correction_currency_mismatch"` | `422 INVOICE_CORRECTION_CURRENCY_MISMATCH` | `requestedCurrency`, `invoiceCurrency` (was `originalCurrency`), `originalInvoiceId`; `details.code` is gone |
| `400 VALIDATION_FAILED`, `details.code = "correction_total_exceeds_lines"` | `400 INVOICE_CORRECTION_TOTAL_EXCEEDS_LINES` | `total`, `linesTotal`, and `currency` (new); `details.code` is gone, except `"below_charges"` when the total is below the charges it credits |
| `422 VALIDATION_FAILED`, `details.code = "correction_exceeds_rate_remaining"` | `422 INVOICE_CORRECTION_EXCEEDS_RATE_REMAINING` | `taxRate`, `vatRatePercent`, `remaining`, and `currency` (new); `details.code` is gone |
| `422 VALIDATION_FAILED`, `details.code = "correction_exceeds_charge_remaining"` | `422 INVOICE_CORRECTION_EXCEEDS_CHARGE_REMAINING` | `details.code` is now the charge (`"delivery"` or `"payment_surcharge"`), `chargeKind`, `remaining`, and `currency` (new) |

The seller refusal is answered by `POST /api/v1/admin/orders/:orderId/invoices` and by automatic
issuance; the four correction refusals by every caller of the corrective-invoice port, which is a
return settlement in this repository. The five codes are members of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `invoices` manifest, and the module's documentation
page names them. `@endora-commerce/mod-i18n` loses the sentence
`errors.VALIDATION_FAILED.correction_exceeds_rate_remaining`, which nothing could render: the
envelope never translates `VALIDATION_FAILED`. The sentence lives on, under the new code, in the
`invoices` bundle. No setting, permission or migration changes.
