---
'@endora-commerce/contracts': minor
---

**Side-table extensions on read ports: the include family** (issue #1835, `specs/187-side-table-extensions/` B1). New `EntityExtensionIncludeSchema` (`extensions.<moduleId>`), `EntityExtensionInclude`, `ENTITY_EXTENSION_INCLUDE_MAX` (8), `EntityExtensionReadOptions` (`{ include?: readonly EntityExtensionInclude[] }`), `WithEntityExtensions<R>` (a host record with an optional `extensions` map, one `T | null` value per present included module) and `entityExtensionModuleOf`. `ERROR_CODES` gains `ENTITY_EXTENSION_UNCLAIMED` (422): an `include` no composed module's loader serves for the host, refused before any loader runs, `details: [{ path: 'extensions.<moduleId>', issue: 'unclaimed' }]`. Additive: nothing changes for a caller that passes no `include`.
