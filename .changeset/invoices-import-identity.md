---
'@endora-commerce/mod-invoices': minor
---

`invoices` identifies an imported sale document by its source system and its id there, and validates what an importer sends

`upsertImportedDocument` used to find an existing `erp_import` row by the source id alone, across every source system, and then overwrite that row's organization, header and reference. After an operator switched ERP, the second system's first colliding id would have taken over the first system's document together with its already-downloaded attachments. The lookup is now scoped to `(externalDocumentRef.system, externalDocumentRef.externalId)`. It still does not narrow by organization: within one source system, a document the source system reassigns to another contractor moves with it.

`upsertImportedDocument` parses its input with `erpSaleDocumentUpsertInputSchema` and refuses a payload that does not parse with `VALIDATION_FAILED`, writing nothing — including a payload in the previous `xlSaleDocumentId` shape from a connector built against an older `@endora-commerce/contracts`.

A new migration, `Migration20260926T230239InvoicesImportIdentity`:

- renames the stored `external_document_ref` keys `xlSaleDocumentId` → `externalId` and `xlDocumentNumber` → `externalNumber`;
- renames `invoice_external_attachments.xl_attachment_id` → `external_attachment_id`, and its unique constraint to `invoice_external_attachments_invoice_external_uq`;
- replaces the unique index `invoices_external_xl_sale_document_uq` with `invoices_external_document_uq` on the pair, for `erp_import` rows;
- adds the check `invoices_erp_import_identity_chk`, which refuses an `erp_import` row with an empty or missing `system` or `externalId`.

Its `down()` restores the previous shape only while a single source system has written; once two systems share an id, recreating the id-only index fails.
