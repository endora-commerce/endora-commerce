---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-invoices': patch
---

`@endora-commerce/contracts` now publishes the invoice **list** replies (issue #599): `adminInvoiceListItemSchema` / `adminInvoiceListResponseSchema` for `GET /api/v1/admin/invoices`, `orderInvoiceListItemSchema` / `orderInvoiceListResponseSchema` for `GET /api/v1/orders/:id/invoices`, and `erpSaleDocumentListResponseSchema` for `GET /api/v1/account/organization/invoices` (rows: the existing `erpSaleDocumentListItemSchema`), each with its inferred type. The routes are typed with them.

Two drifts the new schemas surfaced are fixed in `@endora-commerce/mod-invoices`: an ERP-imported sale document without an order now answers `orderId: null` in the admin list (the key was absent), and `pagination.limit` is the page size asked for, an empty page included (it was the number of rows answered, `0` for an empty page, which `paginationSchema` refuses). The admin invoice list renders a dash for a document without an order instead of failing on it.
