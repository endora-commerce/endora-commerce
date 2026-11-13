---
'@endora-commerce/mod-admin-roles': minor
---

The permission inventory scanner now walks `.tsx` files (issue #1105). It reads the Admin UI's `hasPermission(...)` and `hasAnyPermission([...])` checks in component files, which it never read before. `*.test.tsx` files are skipped, and a relative import may resolve to a `.tsx` file. Two more changes:

- A JSX closing tag such as `</span>` no longer hides a gate written after it on the same line.
- `OWNER[kind].prop` on a module-local map is read as every value the map holds under `prop`, one site each.

`EnforcedGateSite` gains `surface: 'enforcement' | 'admin-control'`. A UI permission check in an admin layer is an `admin-control` site, because it decides whether a control is shown. Every other site is `enforcement`.
