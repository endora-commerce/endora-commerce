---
'@endora-commerce/platform': patch
---

The `excluded-set` tenant filter, and `orgScopeWhere(field)` on its `excluded` arm, now carry the excluded organizations as **one** array parameter — `organization_id <> all(?::uuid[])` — instead of one parameter per id (issue #955). The where fragment is `{ [field]: { $ne: raw('all(?::uuid[])', ['{…}']) } }` (was `{ [field]: { $ne: null, $nin: [...] } }`); an empty list is still `{ [field]: { $ne: null } }`. It matches exactly the rows the `$nin` form did — a null organization never matches — and survives `populate`, `count`, forks and transactions the same way. Code that only passes the fragment to the entity manager needs no change; code that inspected its `$nin` key must not.
