---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-projects': minor
'@endora-commerce/admin-shell': minor
'@endora-commerce/mod-i18n': minor
---

**Breaking:** `GET /api/v1/admin/quote-requests` now answers one page instead of every quote request. The server applies `assignmentScope`, `organizationId`, `status`, `q` (a fragment of the business id, the organization name or the customer's name, or a whole id), `sort` (`updatedAt:desc` by default, `updatedAt:asc`, `total:desc`, `total:asc`) and the page (`page`, default 1; `pageSize`, default 25, at most 200). The `pagination` block is now true for the response: it adds `page`, `pageSize` and `total`, and `limit` and `hasMore` describe the page returned (`nextCursor` stays `null`; ask for the next `page`). An invalid `pageSize`, `page`, `sort`, `assignmentScope` or `organizationId` is refused with 400.

To migrate, a client that read the whole list from one call must page through it with `page` and `pageSize`, or read `pagination.total` when it only needs the count. The contracts publish the query and the envelope as `adminQuoteRequestListQuerySchema` and `adminQuoteRequestListResponseSchema`.

`SalesRepAssignmentPort` gains `listOrganizationIdsWithAssignments()`; an implementation of the port outside this repository must add it. The admin Quote Requests list now asks the server for each page, filter and sort, and offers a lowest-total sort. The home page's pending-quotes tile and the project link picker read the paged list.
