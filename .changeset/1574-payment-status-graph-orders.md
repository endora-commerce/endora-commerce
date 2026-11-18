---
'@endora-commerce/mod-orders': minor
---

**Breaking change:** `POST /api/v1/admin/orders/:id/payment-status` now enforces the payment-status transition graph (issue #1574). Before, it set the asked-for status from any current status, so a refunded order could be marked paid again.

The route now refuses these moves with `409 ORDER_PAYMENT_STATUS_TRANSITION_NOT_ALLOWED` and writes nothing:

- `paid` for a `refunded` order (`details.code` `payment_refunded`).
- `refunded` for an `awaiting_payment`, `failed` or `deferred` order (`details.code` `payment_not_paid`).

`details` also carries `from` and `to`. The message is translated to the operator's language (English and Polish). An order outside the caller's scope still answers `404` first.

Asking for the status an order already has now answers `200`, changes nothing and writes no `order.payment_status_transition` audit entry. Before, it wrote one, and marking a credit-limit order paid twice recorded a second credit release.

`OrderPaymentStatusApplied`, the answer of `orderPaymentStatusApplyPort.applyPaymentStatus`, gains `outcome: 'applied' | 'unchanged' | 'refused'`. Settlement follows the same graph, plus `awaiting_payment` to `failed`. A refused move is an answer, not a throw, and `paymentStatus` is the status the order is at after the call.

**What to do:** an API client that sends `refunded` for an unpaid order, or `paid` for a refunded one, now gets `409`. Use `paymentStatusTargets(current, 'operator')` from `@endora-commerce/contracts` to know what is accepted. A consumer of `orderPaymentStatusApplyPort` should read `outcome` before acting on the move it asked for.
