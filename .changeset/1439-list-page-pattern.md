---
'@endora-commerce/admin-kit': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-carts': patch
---

The admin list page pattern (issue #1439, UX audit DS-05) and a pager on the Customers,
Organizations and Carts lists (issue #1473, SALES-08).

`@endora-commerce/admin-kit/components` exports `ListPage` (with `ListPageProps` and
`ListPageLoad`) — the `PageHeader` with its one "New …" action, a toolbar row that is not a card,
the count in a live region, one results card with loading, error-with-retry and ready states, and
the `PaginationFooter` under it — and `useListPagination({ scope, maxPageSize })` with the pure
helpers `pageSizesUpTo`, `fitPageSize` and `lastPageIndex`. The hook keeps the admin's remembered
page size per list, offers only the sizes the endpoint serves, and moves back to the last page
that exists when a response reports a smaller total. It reads the page-size preference, so it
needs `AuthProvider` above it. The `core` bundle gains `common.list.loadError`. The pattern is
documented in the kit README under "List pages".

`GET /api/v1/admin/organizations` accepts `page` (one-based, default 1) and `pageSize` (1–200;
`limit` when omitted) and answers `meta: { page, pageSize, total }` beside `pagination`, whose
`hasMore` now says whether a later page exists. `@endora-commerce/contracts` adds
`adminOrganizationListPageQuerySchema` and the `meta` member of
`adminOrganizationListResponseSchema`. A caller that names neither parameter keeps its one
`limit`-sized first page, now ordered by `createdAt` and then `id`, so a page boundary never
repeats or skips a row.

The Customers, Organizations and Carts admin lists page through every row, open a record from its
name instead of an "Open" button in each row, tell "none yet" from "none match — Clear filters",
and offer a retry when the list fails to load. The Customers organization filter is the searchable
`OrganizationPicker` instead of a list of the first 50 organizations, and resetting two-step
verification for an organization asks first.
