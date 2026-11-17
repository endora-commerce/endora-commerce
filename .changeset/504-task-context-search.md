---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-projects': patch
---

Issue #504: the Project/Stage picker on a Task's screen (`GET /api/v1/admin/tasks/lookups/contexts`) now reads one bounded page per search. Before, each search listed every Project the caller could see, described them all and asked about each candidate separately, so it got slower as the number of Projects grew.

- `TaskContextDescriptor` gains an optional `search({ q, limit, changeableOnly })`, with the new types `TaskContextSearchQuery` and `TaskContextSearchHit`. A context owner that implements it answers the picker's page itself. The lookup asks it once per search and no longer calls `allVisibleContextIds`, `describe` or `canChangeTasks` for that owner. An owner without it keeps the previous scan.
- The `project` Task context implements it with `ProjectAccess.searchVisibleByLabel`, which is one statement with both visibility rules and a limit, plus one read of the page's Stages. A caller without `projects:write` gets an empty list without any Project being read.

The picker offers the same Projects as before: the ones the caller may see and change, matched on number and title without regard to case or diacritics, sorted by label, at most 20.
