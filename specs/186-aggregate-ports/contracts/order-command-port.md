# Contract: `orderCommandPort` (Order, #1823)

Owner `orders` (non-deactivatable). Declared in `packages/contracts/src/orders.ts`.

## Operations

Readiness codes: research R-2, **as measured by the T003 inventory** (2026-11-26, `origin/master` at
`934991c5b`). "Route" is the admin route for the operation; "Side effects" is everything the route,
or the service it calls, does outside the write itself, which the port call must reach too (FR-013).
File references are relative to `packages/modules/orders/src/backend/` unless they say otherwise.

| Method | Command action (kept) | Admin route | Readiness | Side effects outside the write | Work |
| --- | --- | --- | --- | --- | --- |
| `applyStatus(id, { to, reason? }, options?)` → `OrderTransitionOutcome` | `order.status_transition` (`commands/order-status-transition.command.ts`) | `POST /api/v1/admin/orders/:id/status`; also `POST …/bulk/status`, the assistant tool (`prompt-tools.ts`) and the buyer's `POST /api/v1/orders/:id/cancel` | **H-in** (`services/order-transition-service.ts`: `AuditPort.recordWithin` on the status transaction, actor taken from the caller's `OrderStatusActor`) | before the write, on an unlocked read: graph validation, the veto-capable before-guards, the `order.status.*.before` events; after the commit: the drain of the owed follow-ups (`stock.release`, `credit.release`), then the `order.status.*.after` / `order.status_changed.v1` / `order.cancelled.v1` announcements — all inside `OrderTransitionService.apply`, which route and port share | **convert**; the guards, drain and announcements stay in the service around the Command (finding 1) |
| `applyPaymentStatus(id, { to }, options?)` → `OrderRecord` | `order.payment_status_transition` (`commands/order-payment-status-transition.command.ts`) | `POST …/:id/payment-status` | **H-in** (`services/order-service.ts` `transitionPaymentStatus`, `recordWithin` with the ambient actor) | the credit release a `paid` owes is recorded with the write and drained after the commit, inside `transitionPaymentStatus` | **convert** (finding 2: the settlement's write is not this) |
| `setCustomFieldValues(id, merge, options?)` → `OrderRecord` | `order.custom_fields.update` | `PATCH …/:id/custom-fields` | C (`services/order-audit-state.ts`, inline in the route's factory) | the route validates through `validateAndMerge` inside the Command and maps a field failure to `422 CUSTOM_FIELD_VALUE_INVALID` | port only; the factory takes a merge, the route's patch becomes one |
| `addComment(id, { body, isCustomerVisible, notifyCustomer }, options?)` → `OrderComment` | `order.comment.add` (**new action**, `commands/order-comment-add.command.ts`) | `POST …/:id/comments` | **N** (`services/order-comment-service.ts`, a plain flush under `command-coverage-ignore`) | the buyer's e-mail notice for a customer-visible, notifying comment, after the write, best effort | **convert**; the buyer's own comment runs the same Command (finding 4) |
| `setExternalReference(id, system, value, options?)` → `OrderExternalReference` | `order.external_reference.set` | none — integration only, through `orderExternalReferencePort.set` | C (`services/order-external-reference-service.ts`) | none | port only; parity against the deprecated `set` |
| `place(ctx, request, options?)` → `PlacedOrderRecord` | `order.place` (new) — `order.place_on_behalf` / `order.place_via_api_key` keep their semantics | `POST /api/v1/admin/orders`, `POST /api/v1/orders`, `POST /api/v1/external/orders` | **H-post** (impersonated and admin-created placements: `auditLog.record` after the commit), **N** (the buyer's own placement) | stock allocation, credit reservation, promotion redemption, payment row, proforma, the confirmation e-mail | **not in this change** — issue #1887 makes placement a Command; `place` is added then (US11, R-18.3) |

### `applyStatus` — outcomes

Returns `OrderTransitionOutcome` (`packages/contracts/src/orders.ts`), as `orderTransitionPort` does:
refusals (`not_found`, `unknown_status`, `not_permitted`, `vetoed`) and `already_there` are values, not
exceptions, because callers answer payment and carrier providers. The graph is consulted before the
write, so a refusal writes and records nothing (`services/order-status-outcome.ts`). Unlike
`orderTransitionPort.applyStatus` the actor is ambient: the old `actor: OrderStatusActor` input is gone,
its `source` becomes `options.source` (`payment`, `shipment`, …) — a code, recorded in the entry — and
the actor the status events carry is derived from the ambient context (R-18.2).

**Not offered**: reorder (writes a basket — carts' aggregate), clone to quote (server-side creation is
`quoteRequestCommandPort.create`), bulk status (loop `applyStatus`), status/transition configuration and
list views (order configuration, out of scope per #1823), the buyer's cancellation
(`/api/v1/orders/:id/cancel` — the buyer's own decision, on a customer session; it runs the same
`order.status_transition` Command through the module's own outcome helper, not the port, R-18.5),
the settlement's payment-status write (finding 2).

**Read moved**: `isTerminal(orderId)` → `orderReadPort.isTerminal`.

### Inventory findings (T003)

1. **The status write's audit actor was the caller's.** `OrderTransitionService.apply` recorded
   `order.status_transition` by hand, inside the status transaction, with `actorAdminUserId` /
   `impersonatedCustomerAccountId` filled from the caller's `OrderStatusActor` — the buyer's own
   cancellation wrote the buyer into `impersonatedCustomerAccountId`. As a Command the actor is the bus's
   ambient one: the buyer's cancellation records `actorCustomerAccountId`, an impersonated one both the
   administrator and the customer. The buyer-cancellation predicate (`domain/status-authorship.ts`, issue
   #284) reads these columns; it now counts `actorCustomerAccountId` as a named actor too, so its answer
   is unchanged (R-18.2). The before-guards and the drain stay outside the Command: a veto must be
   decided before anything is written, and the drain runs on its own connection after the commit.
2. **`orderPaymentStatusApplyPort` is not a duplicate of `applyPaymentStatus`.** It is the settlement's
   write: it runs on `payments`' own transaction (the caller's `EntityManager`, D-169, held together with
   the payment row by `payments_order_fk`), judges the move for the `settlement` actor
   (`decidePaymentStatusChange(…, 'settlement')`, which admits `failed`), answers a refused move as a
   value so the payment row still commits, and records no entry (the lifecycle move after it does). A
   port method that opens its own transaction cannot replace it without committing half a settlement.
   `data-model.md` § *Port disposition* listed it as deprecated; R-18.1 keeps it.
3. **Two route-side refusals differ from the port convention.** `PATCH …/custom-fields` answers an
   unknown order `404 NOT_FOUND` (not `ORDER_NOT_FOUND`), and `orderExternalReferencePort.set` answers a
   malformed value `400 VALIDATION_FAILED` (published, issue #1030), where the convention says 422. Both
   are kept on the port, as R-16.5 kept a published code (R-18.8).
4. **Comments were unaudited, the buyer's included.** Both `addByAdmin` and `addByCustomer` carried a
   `command-coverage-ignore` ("append-only thread, no undo value"). Making only the operator's a Command
   would leave one entity with two write paths and a marker whose reason the other path contradicts;
   both run `order.comment.add` (R-18.4). The entry names the comment's id and its two flags, never the
   body (free text, `audit-state.md` list 1). The notice stays after the commit, in the service.
5. **The status write's `reason` is free text** and never entered the entry; it travels on the events
   only. `source` is new on the entries and is added to `ORDER_AUDIT_KEYS`, with the comment keys.
6. **No `version` column.** `expectedVersion` is ignored by every method (R-5). **No hookable action**:
   `orders` declares none, so any `extensions` key is refused `422 COMMAND_EXTENSION_UNCLAIMED`.
7. **The payer is on the order already.** `payer_organization_id`, the payer snapshot and the terms are
   stored (`specs/182-related-payers/`), and the admin serialiser already builds `payer`; the read
   record gains the same `payer`, optional on the type (R-18.7).
8. **Consumers of the deprecated ports** (T061): `payments` (`receive-payment-handler.ts`, after the
   settlement commit; `payment-retry-service.ts`, terminality only), `shipments`
   (`receive-shipment-handler.ts`), `crm` (`order-status-propagation-service.ts`), and `orders`' own
   buyer cancellation. All moved: the first three to `orderCommandPort` / `orderReadPort.isTerminal`,
   the cancellation to the module-internal helper (customer session, R-18.5). `quick_order` stays on
   `orderPlacementPort` until US11. Outside this repository the paid `comarch_xl` module calls
   `orderTransitionPort.applyStatus` with `actor: { kind: 'system' }`; it moves before the removal
   release, passing `source: 'comarch_xl'`.

## Interface (shape)

```ts
export interface OrderCommandPort {
  applyStatus(id: string, input: OrderStatusTransitionInput, options?: AggregateCommandOptions): Promise<OrderTransitionOutcome>;
  applyPaymentStatus(id: string, input: OrderPaymentStatusTransitionInput, options?: AggregateCommandOptions): Promise<OrderRecord>;
  setCustomFieldValues(id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions): Promise<OrderRecord>;
  addComment(id: string, input: OrderCommentInput, options?: AggregateCommandOptions): Promise<OrderComment>;
  setExternalReference(id: string, system: string, value: OrderExternalReferenceWrite, options?: AggregateCommandOptions): Promise<OrderExternalReference>;
  // US11 (#1887), additive when it lands:
  // place(ctx: OrderCustomerContext, request: PlaceOrderRequest, options?: OrderPlaceOptions): Promise<PlacedOrderRecord>;
}
```

`OrderStatusTransitionInput` is `{ to: string; reason?: string | null }`;
`OrderPaymentStatusTransitionInput` is `{ to: 'paid' | 'refunded' }` — the operator's targets
(`adminOrderPaymentStatusTransitionSchema`); `OrderCommentInput` is the admin body.

### `place` (US11) — the payer

`request` is `PlaceOrderRequest` (it already carries `payerOrganizationId`, `specs/182-related-payers/`
FR-063); `ctx` is `OrderCustomerContext`. The payer is chosen and validated by `related_payers`
(`relatedPayerPolicyPort`) inside placement exactly as at checkout; the port never bypasses it, and a
refused payer answers the related-payer refusal with nothing written. The returned record carries
`payer`. With `related_payers` off a request naming a payer is refused as at checkout.
`OrderPlaceOptions extends AggregateCommandOptions` with the existing `language`, `languageTag`,
`workingBasketId` of `orderPlacementPort.placeOrder`. Placement becomes the `order.place` Command in
issue #1887; `orderPlacementPort` is deprecated only when `place` lands.

## Transactions

`applyStatus` keeps `orderTransitionPort`'s rule verbatim: call after your own commit (issue #200). The
same holds for every method: each opens its own Command transaction (R-6).

## Owner off

`orders` is non-deactivatable; sentence as on `orderTransitionPort`.

## Deprecated by this port (0.113.0 → removed 0.114.0)

`orderTransitionPort` (both methods: `applyStatus` → `orderCommandPort.applyStatus`, `isTerminal` →
`orderReadPort.isTerminal`), `orderExternalReferencePort.set`; `orderPlacementPort` when US11 lands.
**Not** `orderPaymentStatusApplyPort` (finding 2, R-18.1).

## Tests

`packages/contracts/src/orders.command-port.test.ts` (shape);
`packages/modules/orders/src/backend/commands/order-commands.test.ts` (the four Commands on the real
bus); `backend/test/contract/orders/order-command-port.test.ts` (parity per method against its route, or
against the deprecated port where there is none; `applyStatus` refusal outcomes write and audit nothing;
`source`; the deprecated ports delegate); `backend/test/integration/orders/order-command-port.worker.test.ts`
(status and payment status from a worker with `source: 'payment'`; a cancellation's follow-ups; the
comment notice); the existing `backend/test/integration/orders/order-transition-port.test.ts`, now over
the delegating deprecated port. US11: `backend/test/integration/orders/order-command-port.place.test.ts`.
