---
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/contracts': minor
---

`CustomerAccountReadPort.findById` and `findByIds` accept `include` beside their lookup options (`CustomerAccountLookupOptions & EntityExtensionReadOptions`), and `searchByEmail` and `listAll` a trailing `options?: EntityExtensionReadOptions`; each returns `WithEntityExtensions<CustomerAccountRecord>` (`specs/187-side-table-extensions/` B2). `include: ['extensions.<moduleId>']` attaches that module's side-table values for `customer_accounts.CustomerAccount` through the platform's `entityExtensionReads`, on the port's own entity manager. Additive: without `include` every method answers exactly what it answered before.
