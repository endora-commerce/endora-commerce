---
'@endora-commerce/mod-carts': minor
---

`carts` provides `cartAnonymizationPort` (issue #920). For every cart of an anonymised customer account it sets `Cart.rejectedReason` and the `reason` of the cart's `cart_audit_entries` rows to `null`; the cart's status, `rejectedAt`, `rejectedByActor` and every other column, and the history's actions, actors, states and metadata, are kept. Each cart it changed gets one `cart.anonymized` platform audit entry with a null actor and `stateBefore: { hadRejectedReason }` only. A cart with no reason left is not touched, so a repeat call writes and records nothing; no event is published. A cart the account only approved or rejected for a colleague is not its cart and is left alone. `cart_audit_entries` is append-only except for this one update.
