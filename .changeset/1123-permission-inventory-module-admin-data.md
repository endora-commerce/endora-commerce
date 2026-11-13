---
'@endora-commerce/mod-admin-roles': minor
---

The permission inventory scanner now reads `requiredPermission` data in a module's admin layer (issue #1123).

- Under a module's `admin/` directory, each `requiredPermission:` declaration is one site: nav entries, zones, tabs and `isVisible({ … })` checks are `admin-control` sites, and a route contribution (an object that also declares `component:`) stays an `enforcement` site.
- A value may be a string literal, a constant, a permission-map member, an array of these, or a spread of a constant array (`[...READ_PERMISSION]`), module-local or imported. An array is one any-of site. A value the scanner cannot read is reported `unresolved`, and a forwarded `item.requiredPermission` is a `runtime-value`.
- In the admin shell, a forwarded `requiredPermission` value is now reported as a `runtime-value` site instead of being skipped.
- `ConstantResolver` gains `lookupArray(file, name)`, which resolves a constant array of permission codes through imports.
