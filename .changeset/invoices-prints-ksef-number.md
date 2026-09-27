---
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-ksef': patch
'@endora-commerce/mod-i18n': patch
---

The invoice PDF and the admin invoice screen print the invoice's KSeF number whatever any module's state

- **PDF.** `invoices.InvoiceHeader` prints `<labelKsefNumber>: <number>` directly under the title row when the invoice has a KSeF number. The label defaults to `Numer w KSeF` and can be changed in the template builder. There is no prop to hide the row. The row is left out only while a block that prints the number itself (a registration with `printsKsefReferenceNumber: true`) is present and placed in the template. For the built-in layout, present is enough. The number is printed exactly once, including for a number an accounting vendor recorded while the KSeF module is off or absent.
- **Admin.** The invoice detail screen shows a *KSeF number* row whenever the invoice has one. The `invoice.detail.after` zone is unchanged.
- `mod-ksef` sets `printsKsefReferenceNumber: true` on `ksef.InvoiceSection`, so an invoice that places that section prints its number once, from the section, as before.
- `mod-i18n` adds `invoiceDetail.field.ksefNumber` in English and Polish.
