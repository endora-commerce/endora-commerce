---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-projects': minor
---

Saved views on the CRM Opportunities page and the Projects list (issue #1734), on the same rules as the order, quote request, return and task lists (`specs/147-saved-views/`).

- `@endora-commerce/contracts` exports `createOpportunitySavedViewRequestSchema`, `updateOpportunitySavedViewRequestSchema`, `createProjectSavedViewRequestSchema` and `updateProjectSavedViewRequestSchema` (with their `Create…`/`Update…` types): `{ name, shared, filters, sort? }`; `visibleColumns` is stripped, since neither list has a column picker. Two error codes join `ERROR_CODES`: `CRM_SAVED_VIEW_NAME_TAKEN` and `PROJECT_SAVED_VIEW_NAME_TAKEN` (the latter also in `PROJECTS_ERROR_CODES`).
- `@endora-commerce/mod-crm` adds `GET`, `POST /api/v1/admin/crm/opportunities/list-views` and `PATCH`, `DELETE …/list-views/:id` (`crm:read`), a `crm_opportunity_list_saved_views` table, and the kit's saved-views control on the list and the board. One view serves both: it stores every filter of the page and the list's sort, never the view.
- `@endora-commerce/mod-projects` adds `GET`, `POST /api/v1/admin/projects/list-views` and `PATCH`, `DELETE …/list-views/:id` (`projects:read`), a `project_list_saved_views` table, and the control on the Projects list.

Run the migrations: each module brings one new table and touches no existing one.
