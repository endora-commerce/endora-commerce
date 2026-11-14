---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-credit-limits': patch
---

The admin credit-limit views now answer each reservation's order number (issue #1178).
`GET /api/v1/admin/credit-limits`, `GET /api/v1/admin/organizations/:id/credit-limit` and
`PATCH /api/v1/admin/organizations/:id/credit-limit` fill `activeReservations[].orderBusinessId`
— the field `creditLimitViewSchema` gained in issue #661 — with the order's `businessId`, or
`null` for an order `orders` did not return. Each reply makes one batched
`orderReadPort.findByIds` read, the list included: the reservations of every listed limit are
read together, never once per limit, and a reply with no reservation reads nothing. The admin
credit-limit screen shows that number in its reservation table, linked to the admin order, in
place of the first eight characters of the order id; the short id remains only for a server that
sends no number. The module's admin entry now imports `react-router-dom`, declared as an optional
peer. `@endora-commerce/contracts` changes only the field's documentation.
