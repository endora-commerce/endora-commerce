---
'@endora-commerce/contracts': patch
---

New exports `uuidShapeSchema` and `isUuidShape(value)`: whether a value has the shape of a PostgreSQL `uuid` (8-4-4-4-12 hexadecimal digits, either case), without the RFC 9562 version and variant check that `uuidSchema` applies. A route keyed by a `uuid` column checks its path parameter with it before the database sees the value, so that a malformed id answers the route's own not-found rather than a 500.
