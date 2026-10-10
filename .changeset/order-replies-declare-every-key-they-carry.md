---
'@endora-commerce/contracts': patch
---

The order contract declares every key the order routes answer.

`orderSchema` is a non-strict object, so it parsed an order reply while silently dropping the keys it did not know — and the routes have been answering three of those:

- **`customFieldValues`** on every order reply (buyer-facing, admin and `/api/v1/external/orders`). `orderSchema` now declares it as `customFieldValuesSchema.default({})`: a reply that carries it keeps it, and a value without the key still parses and reads `{}`.
- **`organization`** and **`customer`** on `GET /api/v1/admin/orders/:id` only. They are declared by the new **`adminOrderDetailSchema`** (type `AdminOrderDetail`), which extends `orderSchema`; both are `null` when the record can no longer be read. No other order reply carries them, and `orderSchema` deliberately does not declare them.

Nothing on the wire changed and no schema was narrowed: every value that parsed before parses now.

One thing to check when upgrading — the inferred **type** `Order` gains a required `customFieldValues: Record<string, unknown>`, because that is what the routes answer. Code that *reads* an `Order` is unaffected; code that *constructs* a value of that type by hand (a fixture, a mock) has to add `customFieldValues: {}`, or build it with `orderSchema.parse(...)`, which fills the default in.
