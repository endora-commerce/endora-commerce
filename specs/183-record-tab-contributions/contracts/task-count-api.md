# Contract: `GET /api/v1/admin/tasks/count`

Owner: `tasks`. Schemas: `packages/contracts/src/tasks.ts`.

| | |
| --- | --- |
| Gate | `requireAdmin('tasks:read')`, declared as the route `preHandler` (`specs/conventions/module-admin-surfaces.md`) |
| Query | `TaskCountQuerySchema`: every filter of `GET /tasks` (`taskFilterShape`), with `linkedKind` and `linkedId` both present or both absent. It has no `sort`, `dir`, `cursor`, `limit` or `cardValues`. |
| 200 | `{ "data": { "count": 3 } }` |
| 400 | A malformed filter, or a custom-field filter the list does not offer (the same as `GET /tasks`, research R-8 of spec 165) |
| 401 / 403 | Not signed in, or no `tasks:read` |
| Off | When `tasks` is off, the route is absent, the same as every `tasks` route (`specs/conventions/module-activation.md`) |

**Semantics.** `count` is the number of rows `GET /tasks` would return under the same filters for
the same caller, across all pages:

- the visibility pre-filter applies first (hidden, private and other people's draft Tasks are
  excluded);
- an unknown status, priority or tag id matches nothing, and is not refused.

**The Tasks tab's call** is `?linkedKind=opportunity&linkedId=<id>&statusCategory=open` (OQ-1 A).
Under OQ-1 B it is the same without `statusCategory`.

**Not cached** (research R5). It is one aggregate over the indexed `task_record_links` predicate.
