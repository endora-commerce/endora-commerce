---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-payments': patch
---

Order invoice PDF downloads serve the issued invoice, rendered from its template (issue #1341):

- `GET /api/v1/orders/:id/invoice` serves the order's newest ready document of kind `invoice`. It no longer serves a proforma or a correction issued after it, and an order with only a proforma answers `404 INVOICE_NOT_READY`. The PDF is rendered from the invoice template, the same as `GET /api/v1/orders/:id/invoices/:invoiceId/pdf`, instead of a one-page summary with the number and total.
- `InvoicePdfPort` gains `renderInvoice(invoiceId)`, which returns the template-rendered PDF of one document. An implementation of the port outside `mod-invoices` must add it. `renderMinimal` is deprecated and no route calls it any more.
- The admin order screen's Payment tab links each ready invoice to `GET /api/v1/admin/invoices/:id/pdf`. It used to link to the customer-only route, which refused the operator's session.
