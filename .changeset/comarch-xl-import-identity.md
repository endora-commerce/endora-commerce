---
'@endora-commerce/mod-comarch-xl': patch
---

`comarch_xl` writes imported sale documents with the renamed identity fields

The sale-document import sends `externalId`, `externalNumber` and `externalAttachmentId` to `invoices`' `erpSaleDocumentWritePort` instead of the `xl*` names, and the attachment fetch reads `externalId` and `externalAttachmentId` from the attachment context. Behaviour is unchanged. It needs an `@endora-commerce/mod-invoices` and `@endora-commerce/contracts` that carry the renamed fields: an older `mod-invoices` does not recognise them.
