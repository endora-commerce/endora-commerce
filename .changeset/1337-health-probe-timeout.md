---
'@endora-commerce/platform': patch
---

`GET /api/v1/_health` now bounds every probe at 200 ms, as the health endpoint documentation already asked (issue #1337). Before, the database ping had no timeout and the Meilisearch ping waited 2000 ms, so a hung database held the request open. A probe that has not answered in time now counts as an unreachable dependency, and the endpoint answers `503` with that check `false`.
