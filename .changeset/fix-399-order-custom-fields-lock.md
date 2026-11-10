---
'@endora-commerce/mod-orders': patch
---

Issue #399 — `PATCH /api/v1/admin/orders/:id/custom-fields` no longer drops a value another writer of the order's custom fields commits at the same moment. The route now reads the order `FOR UPDATE` inside its Command and merges the request into the bag it holds under that lock, so a concurrent writer — such as the system carry that fills an order's empty fields from its Sales Opportunity right after the order is created — is waited for and its value kept.

The request semantics are unchanged: keys the request leaves out are kept, a key sent empty (`null`, `''` or `[]`) clears an optional field and is refused for a required one, and the `order.custom_fields.update` audit entry carries the same before and after state as before, now read under the lock.
