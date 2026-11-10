---
'@endora-commerce/mod-quote-requests': minor
---

Only a sales representative is reach-scoped on the admin quote-request surfaces (issue #957, product-owner ruling 2026-11-08). The list, global search, the detail and history, every action, the create on a customer's behalf and the quote PDF used to narrow every role except `platform_admin` by the sales-representative assignment rule; a custom admin role holding `rfqs:handle` is now platform-wide there, as on every other surface. A sales representative's reach is unchanged.

`RfqAdminService.searchForAdmin(query)` no longer takes an `AdminContext`: the request's tenant scope is the whole of its visibility.

**Behaviour change on upgrade.** An administrator with a custom role holding `rfqs:handle` sees and handles the quote requests of every Organization, not only those assigned to them or to nobody.
