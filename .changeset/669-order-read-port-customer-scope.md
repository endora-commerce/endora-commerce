---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-orders': minor
---

`OrderReadPort` gains `findByIdForCustomer(id, { customerAccountId, organizationId })`. It answers
the order only when that customer may read it under the rule `GET /api/v1/orders/:id` applies — a
regular member reaches the orders they placed, an `organization_admin` every order of their
Organization — and `null` otherwise, which the caller answers as 404. `orders` implements it with
the same access service its own order reads use, so a module serving a customer an order-scoped
resource no longer restates the rule.

The method is required on the interface, so a hand-written `OrderReadPort` (a test fake, for
example) has to add it.
