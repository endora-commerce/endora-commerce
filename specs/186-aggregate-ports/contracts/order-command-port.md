# Contract: `orderCommandPort` (Order, #1823)

Owner `orders` (non-deactivatable). Declared in `packages/contracts/src/orders.ts`.

## Operations

| Method | Command action (kept) | Admin route | Readiness | Work |
| --- | --- | --- | --- | --- |
| `applyStatus(id, { to, reason }, options?)` → `OrderTransitionOutcome` | `order.status_transition` | `POST /api/v1/admin/orders/:id/status` | H-in (`order-transition-service.ts`) | convert; outcomes, not throws |
| `applyPaymentStatus(id, { to }, options?)` | `order.payment_status_transition` | `POST …/:id/payment-status` | H-in (`order-service.ts`) | convert |
| `setCustomFieldValues(id, merge, options?)` | `order.custom_fields.update` | `PATCH …/:id/custom-fields` | C | port only |
| `addComment(id, { body, visibleToCustomer }, options?)` | `order.comment.add` (new action — today unaudited) | `POST …/:id/comments` | N (`order-comment-service.ts`) | convert; the buyer notice stays after commit |
| `setExternalReference(id, system, value, options?)` | `order.external_reference.set` | (integration only) | C | port only |
| `place(ctx, request, options?)` → `PlacedOrderRecord` | `order.place` (new action) — `order.place_on_behalf` stays the action when an administrator places for a customer | `POST /api/v1/admin/orders` | H-post / N | **US11**: convert placement into a Command |

### `applyStatus` — outcomes

Returns `OrderTransitionOutcome` (`packages/contracts/src/orders.ts`), as `orderTransitionPort` does:
refusals (`not_found`, `unknown_status`, `not_permitted`, `vetoed`) and `already_there` are values, not
exceptions, because callers answer payment providers. Unlike `orderTransitionPort.applyStatus` the
actor is ambient: the old `actor: OrderStatusActor` input becomes `options.source` (`payment`,
`shipment`, …) — a code, recorded in the entry.

### `place` (US11) — the payer

`request` is `PlaceOrderRequest` (it already carries `payerOrganizationId`, `specs/182-related-payers/`
FR-063); `ctx` is `OrderCustomerContext`. The payer is chosen and validated by `related_payers`
(`relatedPayerPolicyPort`) inside placement exactly as at checkout; the port never bypasses it, and a
refused payer answers the related-payer refusal with nothing written. The returned record carries
`payer` (`data-model.md`). With `related_payers` off a request naming a payer is refused as at checkout.

Placement as a Command is the largest conversion of the feature (`order-service.ts`, 156 kB): stock
allocation, credit reservation, promotions, the outbox of the confirmation e-mail. It lands as its own
story and may ship in a later release than the rest of the port — adding a method is additive (R-1).
`orderPlacementPort` is deprecated only when it does.

**Not offered**: reorder (writes a basket — carts' aggregate), clone to quote (server-side creation is
`quoteRequestCommandPort.create`), bulk status (loop `applyStatus`), status/transition configuration
and list views (order configuration, out of scope per #1823), buyer cancel (`/api/v1/orders/:id/cancel`
— the buyer's own decision).

**Read moved**: `isTerminal(orderId)` → `orderReadPort.isTerminal`.

## Interface (shape)

```ts
export interface OrderCommandPort {
  applyStatus(id: string, input: { to: string; reason?: string | null }, options?: AggregateCommandOptions): Promise<OrderTransitionOutcome>;
  applyPaymentStatus(id: string, input: { to: OrderPaymentStatus }, options?: AggregateCommandOptions): Promise<OrderRecord>;
  setCustomFieldValues(id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions): Promise<OrderRecord>;
  addComment(id: string, input: OrderCommentInput, options?: AggregateCommandOptions): Promise<OrderComment>;
  setExternalReference(id: string, system: string, value: OrderExternalReferenceWrite, options?: AggregateCommandOptions): Promise<OrderExternalReference>;
  // US11, additive when it lands:
  place(ctx: OrderCustomerContext, request: PlaceOrderRequest, options?: OrderPlaceOptions): Promise<PlacedOrderRecord>;
}
```

`OrderPlaceOptions extends AggregateCommandOptions` with the existing `language`, `languageTag`,
`workingBasketId` of `orderPlacementPort.placeOrder`.

## Transactions

`applyStatus` keeps `orderTransitionPort`'s rule verbatim: call after your own commit (issue #200).

## Owner off

`orders` is non-deactivatable; sentence as on `orderTransitionPort`.

## Deprecated by this port

`orderTransitionPort` (both methods), `orderPaymentStatusApplyPort`, `orderExternalReferencePort.set`;
`orderPlacementPort` when US11 lands.

## Tests

`backend/test/contract/orders/order-command-port.test.ts` (parity; `applyStatus` refusal outcomes write
and audit nothing), `backend/test/integration/orders/order-command-port.worker.test.ts` (status and
payment status from a worker; comment notice), US11: `backend/test/integration/orders/order-command-port.place.test.ts`
(payer allowed / refused; stock and credit effects identical to checkout), delegation tests.
