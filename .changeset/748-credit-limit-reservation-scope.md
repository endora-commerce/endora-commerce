---
"@endora-commerce/contracts": minor
"@endora-commerce/mod-credit-limits": minor
---

`GET /api/v1/me/credit-limit` lists only the reservations of orders the buyer may read (issue #748). A member whose organization role lacks `orders.view_organization` now sees the reservations of the orders they placed, not their colleagues'; a holder of the code, and the Administrator, still sees every reservation of the limit. `grantedAmount` and `availableAmount` stay the Organization's figures.

`creditLimitViewSchema` gains a required `activeReservationCount`: the number of active reservations on the limit, whoever placed the order. A consumer that counted reservations with `activeReservations.length` reads `activeReservationCount` instead, because the list can now be shorter than the count. Every admin credit-limit response carries the field too, equal to the list's length there.
