---
'@endora-commerce/contracts': minor
---

`OrderCommandPort` (container name `orderCommandPort`, owner `orders`) is the Order aggregate's write port (issue #1823, `specs/186-aggregate-ports/`): `applyStatus(id, { to, reason? }, options?)` answering an `OrderTransitionOutcome`, `applyPaymentStatus(id, { to: 'paid' | 'refunded' }, options?)`, `setCustomFieldValues(id, merge, options?)` (a `CustomFieldMerge`), `addComment(id, OrderCommentInput, options?)` and `setExternalReference(id, system, value, options?)`, each ending in `AggregateCommandOptions`. New types `OrderStatusTransitionInput`, `OrderPaymentStatusTransitionInput` and `OrderCommentInput`. `OrderReadPort` gains `isTerminal(orderId)`, and `OrderRecord` gains `payer` (`OrderPayer | null`, optional on the type) — a test double that implements `OrderReadPort` in full needs the new method.

Deprecated since 0.113.0, removed in a later release — each delegates to its replacement:

- `orderTransitionPort.applyStatus({ orderId, to, actor, reason })` → `orderCommandPort.applyStatus(orderId, { to, reason }, { source })`. The input `actor` is no longer recorded: the audit entry names the ambient actor, and `actor.source` is recorded as the entry's `source`.
- `orderTransitionPort.isTerminal(orderId)` → `orderReadPort.isTerminal(orderId)`
- `orderExternalReferencePort.set(orderId, system, value)` → `orderCommandPort.setExternalReference(orderId, system, value)`

`orderPaymentStatusApplyPort` (the settlement's write on the caller's transaction) is not deprecated.
