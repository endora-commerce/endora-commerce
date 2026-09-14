---
'@endora-commerce/mod-invoice-ledger': minor
'@endora-commerce/contracts': minor
---

`invoice_ledger_deliveries` and `invoice_ledger_document_maps` carry their own
`organization_id` and are `@OrgScoped()`. They were
`@TransitivelyScoped('Invoice', 'invoiceId')`, copied from `KsefSubmission` —
and `ksef` declares `invoices` in its manifest `dependencies` while
`invoice_ledger` is `nonDeactivatable` and may not, so an instance installing
the locked set without `invoices` loaded both classes with no `Invoice`
registered and the tenancy reconciliation refused its boot before a single
migration ran.

`InvoiceLedgerEnqueueInput` gains a required `organizationId`, resolved by the
caller through `invoiceCopyHostPort` and frozen on the row beside the
credential, the environment, the numbering mode and the KSeF routing that were
already frozen there. One migration adds the column, backfills it through
`invoices` and `orders` behind a `to_regclass` guard, and foreign-keys it to
`organizations`. There is still no foreign key to `invoices`.
