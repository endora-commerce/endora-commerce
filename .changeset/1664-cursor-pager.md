---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-i18n': patch
---

The kit pager has a cursor mode (issue #1664). `useCursorPagination` is the counterpart of `useListPagination` for an endpoint that pages by cursor and answers no total. `ListPage` draws the same `PaginationFooter` for it, with *Previous* / *Next*, *Page N* and "Showing 21–40 of more than 40" while a next page exists. `PaginationFooter` takes the new `CursorPaginationFooterProps` (`mode: 'cursor'`), and `ListPage` has a `tabs` slot for section tabs between the header and the toolbar.

- **Invoices**: the list is the kit `ListPage`, like the other sales lists (issue #1500, UX audit SALES-24). *Load more* is replaced by the cursor pager. The filters are the kit toolbar: the order-number search, kind and status, with the issue dates and totals behind *More filters*. The empty state tells "no invoices yet" apart from "nothing matches these filters". *Download PDF* and *Resend email* are in each row's menu. The error messages are translated.

Removed unused translation keys (core): `invoices.loadMore`, `invoices.filters.clear`, `invoices.pdfNotReady`, `invoices.resendEmail`, `invoices.kind.all`, `invoices.status.all`.
