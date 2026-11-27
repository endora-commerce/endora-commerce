---
'@endora-commerce/mod-payments': patch
'@endora-commerce/mod-shipments': patch
'@endora-commerce/mod-crm': patch
---

The payment and carrier callbacks and the CRM's order-status propagation move an order's status through `orderCommandPort` instead of the deprecated `orderTransitionPort` (issue #1823, `specs/186-aggregate-ports/`); the buyer's payment retry reads terminality from `orderReadPort`. Behaviour is unchanged; the order's audit entry now records `source: 'payment'` or `source: 'shipment'` beside the system actor. For code that builds them by hand, `ReceivePaymentHandler` and `ReceiveShipmentHandler` take an `orderCommandPort` where they took an `orderTransitionPort`, and `PaymentRetryService` no longer takes `orderTransition`.
