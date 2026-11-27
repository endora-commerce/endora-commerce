---
'@endora-commerce/mod-orders': minor
'@endora-commerce/contracts': minor
---

`OrderReadPort.findById`, `findByIdForCustomer`, `findByIds` and `listAll` accept a trailing `options?: EntityExtensionReadOptions` and return `WithEntityExtensions<OrderRecord>` (`specs/187-side-table-extensions/` B2). `include: ['extensions.<moduleId>']` attaches that module's side-table values for `orders.Order` to the orders found under the caller's scope, through the platform's `entityExtensionReads`: a loader is handed only the orders the port already returned, so an order of an Organization the caller may not reach never reaches it. Additive: without `include` every method answers exactly what it answered before.
