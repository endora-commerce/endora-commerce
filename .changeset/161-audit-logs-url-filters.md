---
'@endora-commerce/mod-audit-logs': minor
---

The audit-log viewer keeps its action, object type and object id filters in the URL (feature 161, G13): `/audit-log?objectType=price_list&objectId=<id>` opens filtered, and a change is written back to the query (`replace`). Old: the filters were component state, lost on reload. New: `?action=`, `?objectType=`, `?objectId=` are read and written; the actor and impersonated-customer filters are unchanged.
