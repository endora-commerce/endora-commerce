---
'@endora-commerce/mod-projects': minor
'@endora-commerce/contracts': minor
---

`ProjectReadPort.findById`, `findByRecord`, `findByIds` and `search` accept a trailing `options?: EntityExtensionReadOptions` and return `WithEntityExtensions<ProjectRecord>` (`specs/187-side-table-extensions/` B2). `include: ['extensions.<moduleId>']` attaches that module's side-table values for `projects.Project` to the Projects `ProjectAccess` lets the caller see — a hidden Project never reaches a loader — through the platform's `entityExtensionReads`. Additive: without `include` every method answers exactly what it answered before.
