---
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-i18n': patch
---

**The admin invoice list pages by cursor, and an ERP WZ document has a label.**

- **Admin API** `GET /api/v1/admin/invoices` now answers what `adminInvoiceListResponseSchema`'s `pagination` block has always declared: `hasMore: true` and an opaque `cursor` while rows remain beyond the page, `cursor: null` and `hasMore: false` on the last one. Pass the cursor back as `?cursor=` with the same filters to read the next page. Rows are ordered newest `issuedAt` first, ties broken by id, so a page boundary never skips or repeats an invoice. A page is filled from the rows the caller's tenant scope lets it see, so a sales representative's page is never shortened by another organization's invoices. A cursor the route did not issue is refused `400 VALIDATION_FAILED`. It always answered `hasMore: false` before, so an instance with more invoices than one page could not reach the rest.
- **Admin UI** — the *Invoices* list has a *Load more* button while more rows exist, and the kind filter offers every kind, `wz` included.
- **i18n** — `invoices.kind.wz` ("goods dispatch note" / "dokument WZ") and `invoices.loadMore` in the `core` namespace, English and Polish. ERP-imported WZ rows showed the raw key `invoices.kind.wz` in the list, on the detail page and in the kind filter.
