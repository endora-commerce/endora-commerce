---
'@endora-commerce/mod-ksef': minor
---

`ksef` renders its own `ksef.InvoiceSection` invoice PDF block, and the verification QR no longer depends on the composition root

The module registers `ksef.InvoiceSection` (the KSeF number, the processing time, the verification QR and the offline marking) into `invoices`' `invoicePdfBlockRegistry` from its own boot hook. Every composition that includes the module prints the QR. Before this change only a root that contributed `ksefVerificationResolver` did, so an instance composed through the platform's `composeApp` printed none.

The invoice template editor's preview binding for the block now ships in this package's admin layer (`src/admin/templates/invoice-section-puck.tsx`). Nothing composes it yet. The editor offers the block through the served descriptor, with a short note on the canvas in place of this preview. That is why `@measured/puck` and `@endora-commerce/page-builder-core` are new optional peer dependencies. Installing the module does not add the block to any existing invoice template.

Requires a `@endora-commerce/mod-invoices` release that provides `invoicePdfBlockRegistry`.
