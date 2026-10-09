---
'@endora-commerce/mod-admin-roles': patch
---

The demo `sales_representative` role can be saved from the role editor again. The demo data seeded
it with `organizations:read.assigned`, a permission code that no module declares and no route
checks, so every save of that role — a rename, one more permission ticked — answered
`400 Unknown permission(s): organizations:read.assigned`, and the editor offered no checkbox to
remove it. The code granted nothing and is no longer seeded.

An instance seeded before this release still holds the code. Running `demo seed` again withdraws
it from the existing role and changes nothing else on it; `demo reset` followed by `demo seed`
does the same by recreating the role.

No API, setting or permission changes.
