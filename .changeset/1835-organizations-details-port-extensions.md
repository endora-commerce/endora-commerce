---
'@endora-commerce/mod-organizations': minor
'@endora-commerce/contracts': minor
---

`OrganizationDetailsPort.findById`, `findByIds`, `searchByName` and `findByTaxId` accept a trailing `options?: EntityExtensionReadOptions` (`findByTaxId` merges it with `includeDeleted`) and return `WithEntityExtensions<OrganizationRecord>` (`specs/187-side-table-extensions/` B1, FR-058). `include: ['extensions.<moduleId>']` attaches that module's side-table values for `organizations.Organization` through the platform's `entityExtensionReads`, on the port's own entity manager. Additive: without `include` every method answers exactly what it answered before.
