---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-credit-limits': minor
'@endora-commerce/mod-i18n': patch
---

`GET /api/v1/admin/credit-limits` pages (issue #1664). `adminCreditLimitListQuerySchema` takes `page` (default 1) and `pageSize` (1–200), and `creditLimitListResponseSchema` now carries `meta: { page, pageSize, total }`, newest grant first with the limit's id as the tie-break. A caller that names no `pageSize` still gets the whole list on one page, with `meta.pageSize` equal to its length (at least 1). `CreditLimitService.listAll()` is replaced by `listPage({ offset, limit? })`, which answers the rows and the total.

- **Credit limits (admin)**: the list is the kit `ListPage` with the kit pager, like the sales lists unified under issue #1500 (UX audit SALES-24). *Grant credit limit* is in the header and in the empty state. It opens a dialog that asks for the organization: one that holds no limit gets the grant form, and one that already holds a limit gets the adjust form. Each row's menu holds *Adjust limit*, which opens the same dialog for that organization with its reservations, and *Open organization*. The look-up card under the list and the *Open* button on each row are gone (UX audit SALES-19, issue #1544). A refused grant or adjustment keeps the dialog open and shows the server's message. A successful one closes the dialog and reports the result next to the list, not in a success banner (issue #1499).
- The page description loses its second sentence. The override checkbox already says that an adjustment below the active reservations is refused unless it is allowed.

Removed unused translation keys (core): `creditLimits.action.lookup`, `creditLimits.action.open`, `creditLimits.editor.title`, `creditLimits.empty`, `creditLimits.error.load`, `creditLimits.field.orgId`, `creditLimits.loading`.
