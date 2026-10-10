---
'@endora-commerce/mod-orders': patch
---

The order serialiser is typed by the published contract, and there is one of it.

The function behind every order reply returned `Record<string, unknown>`, so the compiler held it to nothing, and it existed twice — once for the customer and admin routes and once, line for line, for `/api/v1/external/orders`. Both are now one `serializeOrder` whose return type is `Order` from `@endora-commerce/contracts`; the admin detail is typed as `AdminOrderDetail`. A field the contract does not declare, a required field that stops being emitted, or a value of the wrong type is a compile error instead of something a contract test may or may not meet.

No reply changed: the two functions were identical apart from the buyer's `customerCancellable`, which the external surface never carried and still does not.

The `Order` entity's `billingAddress.companyName` and `billingAddress.taxId` are now typed `string | undefined` rather than `string | null | undefined`. That is what placement — their only writer — has always stored, and what the published `addressSnapshotSchema` says. Code that reads them is unaffected; code that assigns `null` to either no longer compiles and should leave the key out instead.
