---
'@endora-commerce/contracts': minor
---

New exports for the order payment-status transition graph (issue #1574): `PAYMENT_STATUS_TRANSITIONS`, `paymentStatusTargets(from, actor)`, `paymentStatusTransitionActorSchema` (`'operator' | 'settlement'`) with its `PaymentStatusTransitionActor` and `PaymentStatusTransition` types, `orderPaymentStatusRefusalDetailsSchema` (`{ code: 'payment_refunded' | 'payment_not_paid', from, to }`) and the error code `ERROR_CODES.ORDER_PAYMENT_STATUS_TRANSITION_NOT_ALLOWED`.

`paymentStatusTargets(from, 'operator')` gives the statuses `POST /api/v1/admin/orders/:id/payment-status` accepts from `from`. It never includes `from`. A client that offered every value of `adminOrderPaymentStatusTransitionSchema` should offer these instead.
