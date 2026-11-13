---
'@endora-commerce/mod-admin-roles': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
---

The permission inventory scanner (`scanEnforcedPermissionGates`) now reads
`hasAnyPermission(['a', 'b'])` as one gate site that carries every code in the array, in the same
way as `requireAdminAny([...])` (issue #458). It reads an array argument only up to the array's
closing bracket. If code after the array narrows it at runtime, as in `['a', 'b'].filter(f)`, the
scanner still reads `a` and `b`, and ignores any string in the narrowing. The `@@` document-list
gate in CRM and in Projects now uses `hasAnyPermission`, so the scanner checks all four codes in
each gate. Before, it marked them as runtime values and did not check them. Who can open the
`@@` list does not change.
