---
'@endora-commerce/mod-carts': minor
---

**Behaviour break:** a cart awaiting approval that its member changes is no longer approvable as it
is; the buyer must submit it again (issue #649, owner ruling 2026-11-03).

A content change on a `pending` cart — `POST /api/v1/cart/items`, `PATCH` or `DELETE
/api/v1/cart/items/:itemId`, `POST` or `DELETE /api/v1/cart/coupon` — now returns it to
`approval_status: 'not_required'`, the state it was submitted from, clears
`submitted_for_approval_at`, and records an `approval_resubmission_required` audit entry
(`pending` → `not_required`). Until now the cart stayed `pending`, so an Organization administrator
could approve contents other than those the buyer submitted. After the change the cart is gone
from `GET /api/v1/organization/carts?approvalStatus=pending`, `POST
/api/v1/organization/carts/:id/approve` and `…/reject` answer `422 CART_APPROVAL_NOT_PENDING`,
and the cart answers give `primaryCta: 'submit_for_approval'` again. A client that relied on an
edited cart staying `pending` must offer the submit again.

The re-arm of an `approved` cart (back to `pending`) is unchanged, except that a quantity set to
the value it already had is no longer a change and re-arms nothing. Both transitions are now
written in the same transaction as the change they react to; they used to be a second write after
it.

`CartApprovalService.maybeReArm(cart, actor)` is replaced by the synchronous
`reArmWithin(em, cart, actor)`, which stages the transition and its audit row on the caller's
entity manager and flushes nothing — call it before the flush that writes the change.
