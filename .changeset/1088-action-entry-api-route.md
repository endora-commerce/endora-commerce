---
'@endora-commerce/contracts': minor
'@endora-commerce/cli': minor
'@endora-commerce/platform': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-admin-actions': patch
---

A manifest action can declare the admin API route its screen opens on (issue #1088). `ModuleActionSchema` (`@endora-commerce/contracts`) gains an optional `entryApiRoute`, a path under `/api/v1/admin/` written as the route registers it; nothing reads it at runtime and existing manifests are unchanged. `check:action-route-permissions` (`@endora-commerce/cli/rules/action-route-permissions.js`) compares `requiredPermission` against that route alone, at a new `declared` resolution level, instead of reconstructing an entry route from `targetRoute`; a declared route that no registration answers is reported `unresolvable` rather than replaced by the reconstruction. Declare it only where the reconstruction picks the wrong route: a screen served by an API its admin path does not name. `_lifecycle`'s `open-command-outbox` declares `GET /api/v1/admin/command-outbox`, and `import_export`'s two actions declare `GET /api/v1/admin/import-export/entities`, so their three ledger entries in the repository host are gone. The admin-actions module documentation (English and Polish) describes the field.
