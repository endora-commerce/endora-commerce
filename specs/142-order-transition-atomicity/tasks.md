# Tasks: an order transition and its follow-up work cannot come apart

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Format

`- [ ] **ID** description` — files, then **Test**. Test first (Constitution III): write the named
test, see it fail, then implement. Tasks are in dependency order. `[P]` marks a task that touches no
file another open task touches and may run beside it.

**Before T00**: branch off `origin/master`, `pnpm install && pnpm run build:packages`, and re-read
the spec's three *Why* tables against the tree — every row is a reading of `fe0803f2e`.

Integration tests named below live in `backend/test/integration/orders/` and need the services
(`specs/conventions/backend-test-suite.md`); unit tests sit beside their subject in the module
package. **Nothing here may add Redis or BullMQ to the shared test server** — the sweep is driven by
calling `sweep()`.

---

## Phase 0 — premises (measure; leave nothing in the tree)

- [x] **T00** Pin today's behaviour before changing it. Write
  `backend/test/integration/orders/transition-failure-states.test.ts` with one case per row 1–7 of
  the spec's *What a failure leaves behind today*, asserting the **target** behaviour (SC-001), and
  confirm each is red for the reason the row gives. Inject failures by replacing the port in the
  composition under test, never by editing a module. If a row cannot be reproduced, correct the
  spec's table in this task before going on.
  Files: the test; `specs/142-order-transition-atomicity/spec.md` only if a row is wrong.
  **Test**: itself — seven red cases.
  *Measured on `af6e32ab3`*: all seven rows reproduce as the table states — row 1 answers 503 with
  the order `cancelled`, stock and credit held and no announcement; rows 2 and 4 answer 500 in the
  same state (row 4 with the credit already released); row 3 answers 200 with the allocation held;
  row 6 lists the moved order under `skipped` as `terminal`; row 7 answers 503 with `paymentStatus
  = paid`. Row 5 cannot be executed in-process and is represented by every step after the commit
  failing, with recovery driven by the sweep alone. The table needed no correction.

- [x] **T01** Verify plan premises 1–4 (*Handoff*): run `check:port-dependencies`,
  `check:entry-presence` and `check:port-catches` against a throwaway branch containing an
  `effectiveState.isPresent('credit_limits')` decision in `orders`; find the `cliCommands` precedent
  that runs a Command; read the newest periodic worker; name the admin order response schema. Record
  the four answers in plan.md's *Handoff* (replace "premise" with what was found). **If premise 1
  fails, stop and return to the architect** — D3/D4 depend on it.
  Files: `specs/142-order-transition-atomicity/plan.md` only.
  **Test**: none — a measurement; the throwaway branch is deleted.

## Phase 1 — shapes

- [x] **T02** Contracts, additive: `InventoryStockReadPort.unreleasedAllocationsForOrderItems`,
  `CreditLimitReadPort.activeReservationsForOrders`, and `pendingEffects?` on the admin order
  response schema named in T01.
  Files: `packages/contracts/src/inventory.ts`, `credit-limits.ts`, `orders.ts`.
  **Test**: `backend/test/unit/contracts/order-pending-effects.test.ts` — the response schema accepts
  an order with and without `pendingEffects`, refuses an unknown `effect`.

- [x] **T03** [P] `inventory` implements `unreleasedAllocationsForOrderItems` (rows with
  `released_at is null` for the given order items; empty input → empty output, no query).
  Files: `packages/modules/inventory/src/backend/services/` (the stock read port's implementation),
  `src/backend/index.ts` if the registration needs it.
  **Test**: `backend/test/integration/inventory/unreleased-allocations-read.test.ts` — released rows
  excluded; foreign order items excluded.

- [x] **T04** [P] `credit_limits` implements `activeReservationsForOrders` (`status = 'active'`).
  Files: `packages/modules/credit_limits/src/backend/services/` (the read port's implementation).
  **Test**: `backend/test/integration/credit_limits/active-reservations-read.test.ts` — a released
  reservation excluded; an order with none absent from the answer.

- [ ] **T05** Entity `OrderTransitionEffect` and its migration (plan *Data model*). Scaffold with
  `pnpm --filter backend run migration:new -- --module orders --name order_transition_effects`; run
  `composer:generate`; commit the regenerated registry.
  Files: `packages/modules/orders/src/backend/entities/order-transition-effect.entity.ts`,
  `packages/modules/orders/src/migrations/<stamp>_orders_order_transition_effects.ts`,
  `packages/modules/orders/src/migrations/index.ts`, `backend/src/db/migrations-registry.generated.ts`.
  **Test**: `backend/test/integration/orders/transition-effects-schema.test.ts` — a second
  outstanding row for one `(order_id, effect)` is refused; a second row after the first completed is
  accepted; the entity is tenant-filtered.

- [ ] **T06** [P] Pure rule: which effects a transition owes (plan table *Which rows a transition
  writes*).
  Files: `packages/modules/orders/src/backend/domain/transition-effects.ts`.
  **Test**: `…/domain/transition-effects.test.ts` — `→ cancelled` on a credit order owes two; on any
  other order one; `→ paid` (payment status) on a credit order owes one; every other transition
  none.

## Phase 2 — the mechanism (needs Q1 and Q2 answered)

- [ ] **T07** Handlers `stock.release` and `credit.release`: presence first, then the port; answer
  `done` with the owner's result or `blocked` with the module id (plan D2, D3).
  Files: `packages/modules/orders/src/backend/services/order-transition-effect-handlers.ts`.
  **Test**: `…/services/order-transition-effect-handlers.test.ts` — with the owner absent the port
  accessor is **never called** and the answer is `blocked`; with it present the port is called once
  with the right reason; `ALREADY_RELEASED` and `RESERVATION_NOT_FOUND` are `done`.

- [ ] **T08** `OrderTransitionEffectService`: `record(tx, order, effects, origin)`,
  `drainForOrder(orderId)`, `sweep(now)` (plan D6) — claim with `for update skip locked` through
  `em.execute`; outcome recording; back-off; the per-owner presence filter in `sweep`; `warn` from
  the fifth failure (FR-020). The per-row `catch` begins with `rethrowIfModuleDisabled`.
  Files: `packages/modules/orders/src/backend/services/order-transition-effect-service.ts`.
  **Test**: `backend/test/integration/orders/transition-effect-service.test.ts` — a failing handler
  leaves the row outstanding with `attempts = 1` and a later `next_attempt_at`, and does not stop the
  order's other row (FR-009); a blocked handler leaves `attempts` unchanged and sets `blocked_on`;
  two concurrent `drainForOrder` calls run the handler once (FR-010); `sweep` skips rows not yet
  due; with an owner absent `sweep` issues no per-row work for its effect; the back-off caps at 1 h.

- [ ] **T09** `OrderTransitionService.apply` — D5 and D7: the transaction, the row lock and single
  re-evaluation, `recordWithin(tx, …)`, effect rows from T06, then `drainForOrder`, then the emit in
  a `finally`. Remove the `sideEffects` constructor parameter and its closure in `plugin.ts`.
  Files: `packages/modules/orders/src/backend/services/order-transition-service.ts`,
  `packages/modules/orders/src/backend/plugin.ts`, `src/backend/index.ts`.
  **Test**: T00 rows 2, 4, 5, 6 go green; plus, in the same file — two concurrent cancellations
  produce one audit entry and one set of rows (FR-004); a vetoed transition writes no row (FR-003);
  the `.after` events are emitted when the drain's handler fails (FR-011). The existing
  `order-transition-port.test.ts`, `status-lifecycle.test.ts`, `customer-cancel.test.ts` and
  `credit_limits/cancel-releases.test.ts` stay green unedited (SC-004).

- [ ] **T10** `inventory` off: nothing new to write beyond T07–T09 — prove it.
  Files: `packages/modules/orders/src/manifest.ts` only if the `inventoryReservationApplyPort`
  sentence needs a word changed to stay exact.
  **Test**: T00 row 3 green; plus `backend/test/integration/orders/transition-effects-inventory-off.test.ts`
  — cancel while off writes no `inventory` row and leaves `stock.release` blocked; switching on and
  one `sweep()` releases it (FR-008).

- [ ] **T11** *(Q1 = proceed and defer — the recommended answer)* `credit_limits` off: rewrite the
  `creditLimitService` edge's `whenAbsent` and `reason` in `orders`' manifest to say a cancellation
  or a payment proceeds and the reservation is released when the module returns; update
  `backend/test/integration/orders/credit-release-scoped-to-credit-limit-orders.test.ts`, whose two
  503 assertions describe the behaviour being replaced.
  Files: `packages/modules/orders/src/manifest.ts`, that test, and whatever artefact the
  deactivation-consequence ledger regenerates.
  **Test**: T00 rows 1 and 7 green as *proceeds, release blocked, released after switch-on and one
  `sweep()`*; the buyer route `POST /api/v1/orders/:id/cancel` answers 200 with the module off.

- [ ] **T11a** *(only if Q1 = refuse; replaces T11)* Before the write in `apply` and in
  `transitionPaymentStatus`, refuse with 503 `MODULE_DISABLED` when
  `mayHoldCreditLimitReservation(order)` and `credit_limits` is absent. The manifest sentence stays.
  Files: `order-transition-service.ts`, `order-service.ts`.
  **Test**: T00 rows 1 and 7 green as *refused, and the status, audit log and effects table are
  unchanged*.

- [ ] **T12** `OrderService.transitionPaymentStatus` — D8: `paymentStatus`, audit entry and the
  `credit.release` row in one transaction, then drain.
  Files: `packages/modules/orders/src/backend/services/order-service.ts`.
  **Test**: T00 row 7; plus a failing credit release leaves `paymentStatus = paid`, one outstanding
  row, a 200, and is released by the next `sweep()`.

- [ ] **T13** The sweep worker: BullMQ repeatable job every 60 s calling `sweep()` under
  `withSystemScope`, registered through `ctx.worker`, in the shape T01 found.
  Files: `packages/modules/orders/src/backend/workers/transition-effect-sweep-worker.ts`,
  `packages/modules/orders/src/backend/index.ts`.
  **Test**: `…/workers/transition-effect-sweep-worker.test.ts` — the processor calls `sweep` once per
  job inside a system scope; `check:subscribe-seam` stays green.

- [ ] **T14** Callers that explained the old behaviour: delete the now-false comment and the
  rationale built on it in `prompt-tools.ts` (bulk tool) and re-read `classifySkip` in `routes.ts`
  — a moved order can no longer be reported `skipped`. Keep both `rethrowIfModuleDisabled` calls.
  Files: `packages/modules/orders/src/backend/prompt-tools.ts`, `routes.ts`.
  **Test**: T00 row 6 green; `backend/test/unit/orders/prompt-tools.test.ts` green.

## Phase 3 — repair and visibility

- [ ] **T15** The repair command (plan D9): candidates paged from `orders`' tables, holdings from
  T03/T04, dry run by default, `--apply` through one audited Command per page, absent owner reported
  as not examined.
  Files: `packages/modules/orders/src/backend/cli/transition-effects-repair.ts`,
  `packages/modules/orders/src/manifest.ts` (`cliCommands`), a Command under
  `packages/modules/orders/src/backend/` beside the module's other Commands.
  **Test**: `backend/test/integration/orders/transition-effects-repair.test.ts` — spec US3 scenarios
  1–4; a second `--apply` writes nothing; an audit entry exists for the applied page.

- [ ] **T16** [P] `serializeOrder` fills `pendingEffects` from outstanding rows.
  Files: `packages/modules/orders/src/backend/routes.ts`.
  **Test**: `backend/test/contract/orders/admin-order-pending-effects.test.ts` — absent when none;
  present with `blockedOn` when waiting; the customer-facing order response does **not** carry it.

- [ ] **T17** The notice on the admin order page, `pl` + `en`.
  Files: `packages/modules/orders/src/admin/pages/OrderDetail.tsx`,
  `packages/modules/orders/i18n/en.json`, `pl.json`.
  **Test**: the page's component test beside it — notice rendered for a waiting effect naming the
  module, absent with none; `pnpm run check:language`.

## Phase 4 — docs, release, acceptance

- [ ] **T18** [P] Documentation, handed to the product owner: `packages/modules/orders/docs/orders.md`
  (what an outstanding follow-up is; what happens with `inventory` or `credit_limits` off; the repair
  command and its dry run), `en` + `pl`; the upgrade note telling an operator to run the dry run.
  Files: as named; `check:module-docs`.
  **Test**: `pnpm --filter docs run build`.

- [ ] **T19** Release intent: one changeset each for `@endora-commerce/contracts`,
  `@endora-commerce/mod-orders`, `@endora-commerce/mod-inventory`,
  `@endora-commerce/mod-credit-limits` — **minor**. The `contracts` one states that an implementer
  of `InventoryStockReadPort` or `CreditLimitReadPort` must add a method; the `mod-orders` one states
  the new table, the behaviour change of plan *What changes in published surfaces*, and the repair
  command. Re-measure read sizes per `check-estate.md` § *Measuring a read size*.
  Files: `.changeset/*.md`, the read-size record.
  **Test**: `pnpm --filter backend run check:release-intent -- --since origin/master`.

- [ ] **T20** Acceptance: T00's seven cases green; SC-002 as
  `backend/test/integration/orders/transition-effects-fault-injection.test.ts` (a failure at each
  point between the commit and the last release; after the cause is removed, two `sweep()` calls
  leave nothing held); then `typecheck`, `lint`, `check:naming`, `check:language`, the `quality`
  job's checks, `pnpm --filter '!backend' run test`, and the contract and integration trees under
  `backend/test/` for `orders`, `inventory`, `credit_limits`, `payments`, `shipments`.
  Files: the test.
  **Test**: itself.
