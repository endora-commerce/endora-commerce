---
'@endora-commerce/mod-invoices': patch
---

Invoice PDF labels and the names of an invoice's non-product lines come from the module's
bundle in the invoice's language instead of Polish literals in code.

- A rendered invoice draws every label a template prop does not supply — the document
  titles, the header labels, the party labels, the line-table and VAT-summary column headers,
  the totals labels and the default footer — in the document's `language`; an English render
  is English throughout. Invoices are printed in `pl-PL` (owner answer N5), and that render is
  unchanged byte for byte. The overpayment label follows the document language as well, where
  it followed the amount-in-words language before; the two coincide for a printed invoice.
- The delivery, payment-method surcharge and discount lines an invoice itemises, and the
  fallback product name and unit, are named in the invoice's language when it is issued,
  `pl-PL` — so issued invoices carry the same names as before.
- The section builders in `pdf-components/sections.ts` take an optional `labels` argument and
  draw English without it; `TITLES` is removed. `createInvoiceDocumentType` and
  `invoicesModule()` take an optional `translate`. New bundle keys: `pdf.*`, `lines.*`.
