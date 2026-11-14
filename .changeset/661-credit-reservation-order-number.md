---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-credit-limits': patch
---

A credit-limit reservation now carries its order's customer-facing number (issue #661).
`creditLimitViewSchema`'s `activeReservations[]` items gain an optional, nullable
`orderBusinessId: string | null`, the order's `businessId`. The customer's
`GET /api/v1/me/credit-limit` answers it for every listed reservation, from the one batched
`orderReadPort.findByIds` read the route now always makes (before, a holder of
`orders.view_organization` cost no order read); it is `null` for an order the read did not return.
The admin credit-limit views do not send it. The field is additive: a reader that ignores it, and a
view without it, are unaffected.
