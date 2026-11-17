---
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-returns': patch
---

An amount withheld on a return is now invoiced as part of the goods' price, at their VAT rate
(issue #854, owner ruling of 2026-11-07). When a return settled before the order was invoiced
approved less than its default refund, for example to keep a handling fee, the invoice adds a line
*Retained on return: product* (`line_kind: retained`) per order line at that line's VAT rate. Its
gross is what was withheld and its net makes the rate's VAT row the kept goods' gross plus that
amount. Until now the amount showed as an overpayment with no VAT document. An order whose every
line came back is now invoiced when something was withheld on it.

The returned goods take their whole share of the order discount off the invoice's discount line,
and the withheld amount carries none. Issued invoices are not rewritten. Run the `invoices`
migrations: `invoice_lines.line_kind` admits `retained`.
