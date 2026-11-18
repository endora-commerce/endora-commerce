---
'@endora-commerce/mod-payments': minor
---

**Breaking change:** settlement no longer overwrites an order's payment status that does not allow the move (issue #1574). A decline reported for an order already marked paid leaves the order `paid`, a success reported for a `refunded` order leaves it `refunded`, and a full refund reported for an order that was never paid leaves its payment status as it is. The payment row still records what the gateway reported, and the refusal is logged with the payment, the order and both statuses.

Behind a refused move the payment method's `statusOnSuccess` or `statusOnFailure` is not applied, so a late decline no longer puts a paid order on hold. A full refund of an unpaid order still puts the order on hold for review.

`payment.received.v1`, `payment.failed.v1` and `payment.refunded.v1` are still emitted. The `payment_status_changed` e-mail is sent only when it matches the order: "paid" while the order's payment status is `paid`, "failed" while it is `failed`. Otherwise the notifier answers `{ sent: false, reason: 'payment_status_differs' }`.
