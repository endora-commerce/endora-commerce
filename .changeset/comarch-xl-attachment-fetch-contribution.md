---
'@endora-commerce/mod-comarch-xl': minor
---

`comarch_xl` contributes its sale-document attachment fetch to `invoices` instead of publishing `comarchXlSaleDocumentAttachmentPort`

The container name `comarchXlSaleDocumentAttachmentPort` is gone. The module registers its fetch provider into `invoices`' `invoiceAttachmentFetchRegistry` from a boot hook, under the source system `comarch_xl` that its sale-document import already writes, so it needs an `@endora-commerce/mod-invoices` and `@endora-commerce/contracts` that carry that seam. While the module is switched off, `invoices` skips its provider and a not-yet-fetched attachment answers 404; switching it back on takes effect on the next download.
