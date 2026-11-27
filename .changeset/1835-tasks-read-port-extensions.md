---
'@endora-commerce/mod-tasks': minor
'@endora-commerce/contracts': minor
---

`TaskReadPort.findById`, `findByIds`, `search`, `listInContext` and `listOpenInContext` accept a trailing `options?: EntityExtensionReadOptions` and return `WithEntityExtensions<TaskRecord>` (`specs/187-side-table-extensions/` B2). `include: ['extensions.<moduleId>']` attaches that module's side-table values for `tasks.Task` to the Tasks the caller may see — after the whole visibility predicate, so another administrator's private Task never reaches a loader — through the platform's `entityExtensionReads`. Additive: without `include` every method answers exactly what it answered before.
