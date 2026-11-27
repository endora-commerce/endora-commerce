---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
---

`OpportunityReadPort.findById`, `findByDocument`, `listOpenForOrganization`, `findByIds` and `search` accept a trailing `options?: EntityExtensionReadOptions` and return `WithEntityExtensions<OpportunityRecord>` (`specs/187-side-table-extensions/` B2). `include: ['extensions.<moduleId>']` attaches that module's side-table values for `crm.CrmOpportunity` to the Opportunities found under the caller's scope, through the platform's `entityExtensionReads`. Additive: without `include` every method answers exactly what it answered before.
