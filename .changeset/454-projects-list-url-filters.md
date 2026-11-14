---
'@endora-commerce/mod-projects': patch
---

The Projects list in the admin (`/projects`) now keeps its filters and its sort in the address
(issue #454). The parameters carry the names `GET /api/v1/admin/projects` takes — `q`, `state`,
`organizationId`, `memberId` (an administrator's id, or `me` for *Only my projects*), `roleId`,
`templateId`, `stageName`, `sort`, `order` — and custom-field filters use the admin kit's
`cf.<key>.<op>` parameters. Back, a reload and a shared link keep the filters, and another screen
can link to a narrowed list. A parameter the list does not take (an unknown state, a value that is
not an id, a sort the server does not serve) is ignored, and a Role or Template the screen's choices
no longer hold is removed from the address once they are read. The Organization and member filters
show the name of a value they were given in the address. On the Organization screen, the Projects
panel's *All projects* link now opens `/projects?organizationId=<id>`.
