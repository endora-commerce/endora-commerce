---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-returns': minor
---

**The content of an invoice issued after a return changes** (issue #435). An invoice or proforma issued once a return has been settled, while the order has no invoice yet, now lists only what the buyer kept: each order line is invoiced at its ordered quantity less the quantity of the order's settled `return`-kind cases resolved with a refund or a credit — whether or not the money has been paid out — and a line returned in full is left off. Before, every order line was invoiced at its ordered quantity, so the amount due included goods the buyer had returned. Replacement, repair and complaint cases change no line; the delivery, payment-surcharge and discount lines, the per-rate VAT on the sum of the nets and `paidTotal` (captured − refunded) are unchanged, and an order refunded in full is still refused with `422 INVOICE_ORDER_REFUNDED`. With `returns` switched off, every line is invoiced as before. Invoices already issued are not touched.

`ReturnRefundReadPort` (`returnRefundReadPort`, owned by `@endora-commerce/mod-returns`) gains `listReturnedQuantities(orderId)`, returning the new `OrderReturnedQuantity` (`{ orderItemId, quantity }`) from `@endora-commerce/contracts`. The change is additive for a consumer of the port; an implementation of `ReturnRefundReadPort` outside `@endora-commerce/mod-returns` adds the method.
