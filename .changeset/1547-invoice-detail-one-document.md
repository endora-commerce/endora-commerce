---
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-i18n': patch
---

The admin invoice detail draws the invoice as one card instead of six (issue #1547, UX audit SALES-25): Details, Seller and Buyer sit side by side under section headings, the details as a description list and each party as an address, followed by the lines, whose table footer carries the VAT summary per rate and the document totals, as the order detail does. Contributions to the `invoice.detail.after` zone render below the card. The header has one primary action (DS-07): *Download PDF* on a ready invoice, *Regenerate PDF* on a pending one, with the remaining actions in the "More" menu, which is disabled while one of them runs. New `core` copy `invoiceDetail.vatRow`, in English and Polish; the unused `invoiceDetail.section.vatSummary` and `invoiceDetail.section.totals` are removed.
