---
'@endora-commerce/mod-organizations': patch
---

The admin Organization routes now apply the acting administrator's Organization reach (issue #698). `Organization` is a global entity, so no tenant filter narrowed these routes, and a sales representative confined to their assigned Organizations could list, open, edit, block, restrict and delete any Organization. `GET /api/v1/admin/organizations` now lists only the Organizations in reach — the assigned ones, expanded to their subtree under `organizations:rollup` — filtered in the query, so a page is still full. Every `/api/v1/admin/organizations/:id` route, its nested reads and writes included (addresses, restrictions, applicable price lists, VAT validations, subtree, ancestors, sales channels, moderation, members, recover administrator access, delete), answers an Organization outside the reach with `404 NOT_FOUND`, the same answer an unknown Organization gets. A platform administrator is unaffected.
