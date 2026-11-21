---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-related-payers': minor
---

`GET /api/v1/admin/related-payers/requests` pages (UX audit DS-05, issue #1439). `adminRelatedPayerRequestsQuerySchema` takes `page` (default 1) and `pageSize` (1–200, `ADMIN_RELATED_PAYER_REQUESTS_MAX_PAGE_SIZE`), and `adminRelatedPayerRequestsResponseSchema` now carries `meta: { page, pageSize, total }`. The order is unchanged: oldest first, with the request's id as the tie-break. A caller that names no `pageSize` still gets the first 500 entries, the queue's old cap, with `meta.pageSize` 500. `RelatedPayerRequestService.listQueue()` answers `{ rows, page, pageSize, total }` instead of an array. `AdminRelatedPayerRequestsQueryInput` is the query a caller sends (`page` optional).

- **Payer requests (admin)**: the queue is the kit `ListPage` with the kit pager (DS-05). The state and reason filters are a labelled `ListToolbar`, with *Clear all filters* while the queue is narrowed (DS-06, #1440). A row's *Approve* is an outline button, never filled, and only on a request whose organization is settled; *Assign organization*, *Create organization*, *Send invitation* and *Reject* (last) are in the row's menu (DS-07, #1441). An empty queue and a filtered-out one are two empty states, the second with *Clear filters* (DS-15, #1448). The results card is the kit's, so the `p-0` override is gone (SHELL-18, #1502). Each decision's result is said above the list in a status line, not a banner; a refusal in a dialog stays in the dialog. The page's description is one line, and the rest moved behind its ⓘ.
- The module now declares `lucide-react` as an optional peer.

Removed unused translation keys (`related_payers`): `queue.loading`, `queue.empty`, `queue.retry`, `queue.column.actions`.
