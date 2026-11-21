---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-tasks': minor
---

New endpoint `GET /api/v1/admin/tasks/count`, gated by `tasks:read`. It answers `{ data: { count } }`: the number of Tasks `GET /api/v1/admin/tasks` would return to the same caller under the same filters, across all pages. The same visibility rules apply, so another administrator's private Task or draft, and a Task in a context the caller cannot see, are not counted. It takes every filter of the list (`TaskCountQuerySchema`) and refuses `sort`, `dir`, `cursor`, `limit` and `cardValues`. `@endora-commerce/contracts` exports `TaskCountQuerySchema`, `TaskCountSchema` and `TaskCountResponseSchema`, and the Tasks admin client gains `tasksApi.countTasksBy(query)`. While the `tasks` module is off, the route answers `503 MODULE_DISABLED`, like every other `tasks` route.
