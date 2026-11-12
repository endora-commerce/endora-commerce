---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-orders': minor
---

Issue #1030 — a module that hands orders to another system (an ERP, a warehouse system, a fulfilment connector) can now record that system's number for an order, where the hand-over stands, and the other system's words on a refusal, **on the order**, through a new published port.

- **`@endora-commerce/contracts`** adds `OrderExternalReferencePort`, registered as `orderExternalReferencePort` (also exported as `ORDER_EXTERNAL_REFERENCE_PORT`), with `set(orderId, system, { state, reference?, message? })`, `get(orderId, system)`, `listForOrder(orderId)` and `findOrderIds(system, reference)`. Beside it: `OrderExternalReference`, `OrderExternalReferenceState` and `ORDER_EXTERNAL_REFERENCE_STATES` (`pending`, `synced`, `error`), `orderExternalReferenceSystemSchema`, `orderExternalReferenceWriteSchema`, `ORDER_EXTERNAL_REFERENCE_MESSAGE_MAX` (1000) and `ORDER_EXTERNAL_REFERENCE_MAX` (255). `adminOrderDetailSchema` gains `externalReferences` (`AdminOrderExternalReference[]`), which defaults to `[]` so a reply from an older server still parses.
- **`@endora-commerce/mod-orders`** implements the port. Each change is one Command, `order.external_reference.set`, audited with the calling actor; a write that changes nothing records nothing and does not move `updatedAt`. An order the caller cannot see is refused `404 ORDER_NOT_FOUND`; a malformed system key, state, reference or message `400 VALIDATION_FAILED`. Entries are org-scoped and outlive the module that wrote them. The admin order page shows an *External systems* section (system, reference, state badge, message; an empty state when none has reported), `GET /api/v1/admin/orders/:id` carries the entries, and the admin orders list's search (`q`) also matches a reference fragment, case-insensitively.

**On upgrade.** Migration `20261110T143322_orders_order_external_references` creates the empty `order_external_references` table. Nothing existing changes; buyer-facing reads do not carry the entries.
