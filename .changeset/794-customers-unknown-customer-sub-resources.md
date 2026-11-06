---
'@endora-commerce/mod-customers': minor
---

The admin sub-resources of a customer that does not exist answer `404 CUSTOMER_NOT_FOUND`, as the customer itself and a malformed id do (issue #794). Before, `PATCH …/custom-fields` and `POST …/impersonate` answered `404 NOT_FOUND`, `POST …/addresses` answered `410 CUSTOMER_ADDRESS_BOOK_RETIRED`, and `GET …/addresses`, `…/orders`, `…/quote-requests` and `…/carts` answered `200` with empty lists. A customer outside a scoped operator's reach reads as absent, so it now answers the same `404`. The permission is still judged first: a caller without `customers:impersonate` is refused `403` whether or not the customer exists.
