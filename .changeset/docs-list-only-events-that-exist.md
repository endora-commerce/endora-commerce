---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-payments': patch
'@endora-commerce/mod-credit-limits': patch
---

The module documentation pages no longer list events that nothing emits. `orders` listed
`order.cancelled.v1`, `payments` listed `payment.settled.v1` and `credit_limits` listed
`credit_limit.reservation_released.v1` under "Events emitted"; none of the three has ever been
emitted. A cancellation is announced as `order.status_changed.v1`, a settled payment as
`payment.received.v1`, and releasing a credit reservation emits no event. The `payments` and
`credit_limits` pages also say that their events are internal to the event bus and are not
delivered to outbound webhooks.

Documentation only: no event, API or behaviour changes.
