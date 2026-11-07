---
'@endora-commerce/mod-organizations': patch
---

`GET /api/v1/admin/organizations/:organizationId/sales-reps` now answers by the same organization reach as every other `/api/v1/admin/organizations/:id` route (issue #856, following #698). A sales representative gets the list for an organization assigned to them (with `organizations:rollup`, for one whose nearest assigned ancestor is theirs) or for one no representative is assigned to. An organization assigned to another representative answers `404 NOT_FOUND`, like an unknown id, so its representatives' names and e-mail addresses are no longer readable. The route also answers `404` for a deleted organization, as the other `/:id` routes do. A platform administrator is not affected.
