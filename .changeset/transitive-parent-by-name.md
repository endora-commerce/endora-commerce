---
'@endora-commerce/platform': major
---

`TransitivelyScoped` names its parent aggregate by **class name** instead of by a class
thunk, so an entity can express a tenancy chain into a module whose package publishes an
`entities` array and no named entity class.

```diff
-import { Order } from '../../orders/entities/order.entity.js';
-
-@TransitivelyScoped(() => Order, 'orderId')
+@TransitivelyScoped('Order', 'orderId')
 @Entity({ tableName: 'invoices' })
 export class Invoice {}
```

The thunk overload is **gone**, not deprecated: it had no remaining call site once the
platform's own two were converted, and keeping both forms would have been two ways to say
one thing.

`ClassificationMeta.parent` (`() => EntityClass`) is replaced by
`ClassificationMeta.parentClassName` (`string`). Nothing in the platform read the old field.

**Three new exports on `tenancy/org-scoped.decorator.js`**, none of them on the `./tenancy`
barrel — they are the host's, as `tenantClassifications` already is:

- `resolveTransitiveParent(child)` — the parent's `ClassificationMeta`, resolved lazily
  against the registry, so a child decorated before its parent is imported resolves fine.
- `assertTransitiveParentsResolve()` — reconciles every transitive chain at once. Call it
  where the host enumerates its entity classes, after every classification decorator has
  run and before the ORM is configured.
- `UnresolvableTenantParentError` — thrown by both when a parent name matches no classified
  entity, or matches more than one. There is no fallback: a transitively scoped entity has
  no tenant column of its own, so a chain that stopped resolving would be an untenanted
  read.

The class name is the key because the registry is already addressed by it and MikroORM
refuses two entities sharing one at discovery. The schema does not change — same foreign
key, same column, same chain.
