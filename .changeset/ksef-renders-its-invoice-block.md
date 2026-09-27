---
---

`@endora-commerce/mod-ksef` left this repository with feature 134's `ksef` departure; the change
this changeset described — the module rendering, describing and registering its own
`ksef.InvoiceSection` PDF block into `invoices`' `invoicePdfBlockRegistry` from its own boot hook,
so every composition that includes it prints the verification QR — is carried in the module's
history and released from the paid-modules repository. `invoices`' half of the same change is
released by `invoices-contributed-pdf-blocks` and `invoice-pdf-block-seam-contract`. No other
package in this workspace changes.
