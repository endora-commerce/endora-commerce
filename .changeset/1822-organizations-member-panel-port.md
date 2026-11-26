---
'@endora-commerce/mod-organizations': patch
---

The operator's member panel (`/api/v1/admin/organizations/:id/members…` — create, role, roll-up, profile, removal and the recover-admin-access promotion) now writes through `customer_accounts`' `customerAccountCommandPort` (issue #1822, `specs/186-aggregate-ports/`), the port a server-side caller uses. Requests, responses and audit entries are unchanged. The module's options gain `customerAccountCommandPort`, and the admin routes' deps take it in place of `customerAccountWrite`, `customerAccountRoles` and `roleService`.
