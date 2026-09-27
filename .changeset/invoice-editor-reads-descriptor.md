---
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-i18n': patch
---

The invoice template editor offers blocks other modules declare, and keeps blocks it cannot show

The editor now reads `GET /api/v1/admin/invoice-templates/page-builder/config` and merges it into its own configuration through `withDescribedInvoiceBlocks`:

- A block that a present module declares, and that this module has no editor binding for, can be inserted and configured from the *Invoice sections* palette. Its fields come from the descriptor. On the canvas it appears as a short note naming the module that draws it on the PDF. *Preview PDF* shows the real output.
- A stored block that nothing covers keeps its place and its props, and shows a note saying it is not available on this instance and is not printed. This covers a module that is off, a module that is not installed, and a name nobody recognises. The block is not offered in the palette.
- If the descriptor cannot be fetched, the editor keeps its own blocks and still shows every stored block it cannot render as that note. No block is dropped.

`mod-i18n` adds the three `invoiceTemplates.describedBlock.*` strings in English and Polish.
