---
'@endora-commerce/mod-invoices': minor
---

Invoice PDF blocks declared by another module are rendered through `invoicePdfBlockRegistry`, and `ksefVerificationResolver` is gone

- **New registration, `invoicePdfBlockRegistry`.** A module that declares an invoice template block registers its renderer, its builder description and the per-render data it needs (see `InvoicePdfBlockRegistration` in `@endora-commerce/contracts`). While the contributing module is not present, its block is not rendered, not described and its data is not read. A stored template that places the block keeps it, and the PDF simply has no such section. The built-in fallback layout ends with the present contributors' blocks.
- **Removed: the `ksefVerificationResolver` contribution point and `InvoicePdfRenderer.setKsefVerificationResolver`.** A composition that contributed `ksefVerificationResolver` drops that line. The KSeF module now registers its block, verification QR included, itself. `InvoicePdfRenderer` gains `content(invoice, locale, tree?)`, which returns the pdfmake content every render path uses.
- **The generic invoice template seed no longer contains `ksef.InvoiceSection`.** A new instance's generic template has eight blocks, all of them this module's. Existing templates are not rewritten, because the seed revision is unchanged. An operator who wants the KSeF section places it in the template builder.
- **The invoice template editor no longer binds `ksef.InvoiceSection`.** The builder descriptor (`GET /api/v1/admin/invoice-templates/page-builder/config`) now describes this module's ten blocks plus each present contributor's block.

`minor` rather than `patch` because a registration name and a public method were removed.
