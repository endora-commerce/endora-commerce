---
'@endora-commerce/mod-invoices': minor
---

Migration `Migration20261108T073244InvoicesInvoiceLineKind` adds a nullable `invoice_lines.line_kind` (`goods`, `delivery`, `payment_surcharge`, `discount`, `price_reduction`), an internal column read through the `InvoiceLine` entity's `lineKind` (issue #904). It is not published on the API: `invoiceLineSchema` and the invoice responses are unchanged. Every line of a newly issued invoice or proforma records its kind, including the 0 % delivery and surcharge lines; `RawOrderLine` and `BuiltInvoiceLine` carry it. No amount changes. Lines issued earlier and correction lines stay `null`.
