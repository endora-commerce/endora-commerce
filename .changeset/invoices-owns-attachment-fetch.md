---
'@endora-commerce/mod-invoices': minor
---

`invoices` owns the first download of an ERP-imported attachment and dispatches it by source system

The customer route `GET /api/v1/account/organization/invoices/:invoiceId/attachments/:attachmentId` no longer resolves `comarchXlSaleDocumentAttachmentPort`. The module registers `invoiceAttachmentFetchRegistry` (an ungated contribution registry), and a connector registers a fetch provider into it keyed by the source system its import writes into `externalDocumentRef.system`. On each download the registry checks that the invoice and the attachment belong to the calling organization, then calls the provider of that document's own system if its module is effectively present. It never falls back to another provider. An absent, switched-off or unknown provider answers 404, as an unfetchable attachment already did, and a file stored earlier stays downloadable. Registering a second provider for a system that already has one throws.

The manifest no longer declares a `refuses-without` edge onto `comarch_xl`. A connector that still provides `comarchXlSaleDocumentAttachmentPort` instead of registering into the new seam is no longer called: its attachments answer 404 until it registers.
