---
'@endora-commerce/mod-invoices': patch
---

A corrective invoice of an invoice issued under the per-rate VAT method now leaves, per rate, what
the invoice keeps (issue #873). When a return refunds its default amount, the net and VAT left at
each rate are VAT per rate on the nets of the kept quantities, the figures an invoice issued after
the same return lists. For example, returning one unit of 3 × 10.01 net at 23 % credits 10.01 net
and 2.31 VAT and leaves 20.02 / 4.60; until now it credited 10.02 / 2.30 and left 20.01 / 4.61.
An operator-reduced amount splits the gross the invoice keeps at the rate by the same rule. Where
no net carries that gross, the correction itself follows the rule and what is left may be 0.01 off
it at that rate (owner ruling E1); the money is always exact.

Only corrections issued from now on change; issued ones are not rewritten. An order placed before
0.108.0 and invoiced per rate now keeps its unpaid cent as 0.01 net and no VAT, where its
correction used to leave 0.00 net and 0.01 VAT.

`correctionAmounts` (`services/corrective-invoice.ts`) takes `originalSummary` and the quantity and
unit net price of every `CreditedLine`, and reports how each rate's net was found in `paths`.
