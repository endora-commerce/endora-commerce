# Implementation Plan: an order transition and its follow-up work cannot come apart

**Spec**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md)
**Measured on**: `origin/master` at `fe0803f2e`

## Summary

An order transition writes its status, its audit entry and **one row per follow-up it owes** in a
single transaction. After the commit the rows are executed at once, in the same request, through the
ports `inventory` and `credit_limits` already publish; whatever does not complete stays in the table
and is retried by a BullMQ sweep until it does. A follow-up whose owning module is switched off
waits, untouched, for the module to return. Nothing can refuse after the write any more, so the
caller is always told the truth, and *"the order is already at the target status"* becomes a correct
answer because what the status owes is recorded beside it. Orders already stranded are found and
repaired by an operator command that feeds the same table.

## Technical context

- TypeScript 5.x strict, Node.js ≥ 22.17, ESM; Fastify, MikroORM (PostgreSQL), Zod, BullMQ — all
  existing. **No new runtime dependency.**
- Storage: one new table owned by `orders`. No change to any existing table.
- Packages touched: `@endora-commerce/mod-orders`, `@endora-commerce/contracts`,
  `@endora-commerce/mod-inventory`, `@endora-commerce/mod-credit-limits`. All public at 0.102.0 —
  see *What changes in published surfaces*.
- Routed conventions the implementer opens: `specs/conventions/module-composition.md` (items 4a, 5,
  6a, 7), `module-activation.md` (workers; presence decided before the work), `module-migrations.md`,
  `module-i18n.md`, `module-documentation.md`, `release-intent.md`, `check-estate.md`
  (§ *Measuring a read size* — this feature adds files).

## Decisions

**D1 — Follow-ups are durable rows written with the status, executed after the commit.**
*Decision*: a transactional outbox inside `orders`: table `order_transition_effects`; rows inserted
in the same transaction as `order.status` and the audit entry; executed post-commit by idempotent
handlers; retried by a sweep (D6).
*Rationale*: it is the only one of the three shapes that answers **both** defects and the two
states neither defect names. A refusal after the write disappears because nothing after the write
can refuse (defect 1). A skipped follow-up is no longer skipped permanently because the fact that it
is owed is data, not control flow (defect 2). A switched-off module becomes *"wait"* rather than
*"silently do nothing"* (spec row 3). A crash between commit and release is recovered (row 5). It
needs **no change to either release port**: `releaseByOrder` and `releaseForOrderItems` already run
in their own transaction and are already idempotent, which is exactly what a retried handler needs.
And the repair of existing orders is the same mechanism with a different author of the rows.
*Rejected*:
- **(a) One transaction around the status and the releases.** It closes the window completely where
  it applies, and it is the shape placement uses for *reserving*. Rejected as the mechanism because
  (i) it cannot express *deferred*: with `inventory` off there is nothing to do inside the
  transaction and nothing left behind to do later, so row 3 needs a durable record anyway — and once
  that record exists, a second, synchronous mechanism beside it is two ways to release one thing;
  (ii) `CreditLimitPort.releaseByOrder` takes no transaction, so the published port would have to
  change, and an *optional* `tx` is the shape that port's own documentation calls a lie about the
  seam; (iii) it holds another module's row locks (the credit row, the stock rows) for the length of
  `orders`' transaction on every cancellation, to save a window D1 already makes harmless;
  (iv) it does nothing for the orders already stranded.
- **(b) A per-effect veto before the write, alone.** Cheap, and it would make the manifest's
  *"can be neither cancelled nor marked paid"* true. Rejected as the mechanism because it is a check,
  not a guarantee: the module can be switched off, the connection lost or the process killed between
  the check and the release, and each lands in exactly today's state. It also has no answer for a
  `degrades-without` owner, where the correct behaviour is not a veto at all. It survives as an
  **optional pre-write check** if Q1 is answered *refuse* (D4).
- **Enqueue a BullMQ job after the commit, with no table.** The enqueue is itself a step after the
  commit that can fail; it moves the gap, it does not close it. Redis is not the system of record
  for stock or credit.
- **Route the transition through `CommandBus.run`.** It would supply the transaction, but also
  undo — and an undone cancellation would have to re-reserve stock and credit that may be gone. The
  seam's existing co-transactional audit (`recordWithin`) is kept.

**D2 — A closed set of two effects, owned by `orders`, calling published ports.**
*Decision*: `stock.release` and `credit.release`, each a function in `orders` taking the order id
and reason and returning `{ outcome: 'done', result } | { outcome: 'blocked', moduleId }`. The
handlers call `InventoryReservationApplyPort.releaseForOrderItems` (via the existing
`OrderService.releaseAllocations`) and `CreditLimitPort.releaseByOrder`.
*Rationale*: Principle I — `orders` decides *that* something is owed from state it owns (the status,
`paymentMethodSnapshot.kind`); the owner decides *how* it is released, behind its port. No entity,
table or service of either owner is named.
*Rejected*: **a published contribution port so any module can register a durable transition
effect** — no second consumer exists (Principle IV), and the `.after` events already serve modules
that only need to react. **Moving the outbox into the platform as a general facility** — one user;
revisit when a second seam needs it.

**D3 — Presence is decided before the port is touched, and "absent" is a value.**
*Decision*: each handler asks `effectiveState.isPresent('<owner>')` first and returns `blocked`
without resolving the port. A blocked row keeps `attempts`, records `blocked_on`, and is eligible
again at the next sweep. The sweep evaluates presence **once per owner per pass** and excludes the
effects of absent owners in its query, so rows waiting on a module that is off for months cost
nothing per row.
*Rationale*: `module-activation.md` — at an entry point with no caller to answer, presence is
decided before the work. It also means no `catch` has to interpret a `ModuleDisabledError`
(`module-composition.md` item 7). The per-row `catch` the sweep needs (one failing row must not stop
the others) is the *narrow tolerance* item 7 allows, with `rethrowIfModuleDisabled` as its first
line.
*Accepted residue*: a module switched off in the instant between the presence answer and the port
call raises `ModuleDisabledError` out of the attempt. In the sweep it fails that pass and the row is
found blocked on the next one. In the request path it surfaces as a 503 after a committed status —
the one remaining way to see that answer — but the row is recorded and retried, so nothing is
stranded and a repeat correctly answers `already_there`.

**D4 — With `credit_limits` off, the release waits (Q1, recommended answer).**
*Decision*: cancelling or marking paid an order placed on credit proceeds; `credit.release` is
recorded and blocked on `credit_limits`. The `creditLimitService` edge stays `refuses-without`
(placement on credit still refuses) and its `whenAbsent` sentence is rewritten to say that a
cancellation or a payment proceeds and the reservation is released when the module returns.
*Rationale*: spec Q1. The refusal's stated ground — the credit cannot be given back while the owner
is absent — no longer holds once the release is durable.
*If the owner answers "refuse"*: T11a replaces T11 — before the write, an order for which
`mayHoldCreditLimitReservation` is true and `credit_limits` is absent is refused with the existing
503 `MODULE_DISABLED`, and the sentence stays. D3 still applies to the handler, for the residue.
*Rejected*: **reclassifying the edge `degrades-without`** — placement does not degrade, it stops.

**D5 — The write is one explicit transaction with the order row locked.**
*Decision*: `apply` keeps its order — load, early return on `from === to`, graph, before-guards —
then opens `em.transactional`, re-reads the order `FOR UPDATE`, and if its status is no longer
`from` abandons the transaction and re-evaluates once from the top; otherwise it sets the status,
calls `auditLog.recordWithin(tx, …)`, persists the effect rows, and commits.
*Rationale*: FR-001, FR-004. Today's single `flush()` is already atomic for status and audit; the
lock is what makes the effect rows' *at most one outstanding per order and effect* index (data
model) a rule the code keeps rather than a constraint it trips.
*Rejected*: **an optimistic version column on `orders`** — a schema change to an existing table for
a contention that is rare and short.

**D6 — The table is the queue; BullMQ is the clock.**
*Decision*: `OrderTransitionEffectService` with `drainForOrder(orderId)` (called inline after the
commit) and `sweep(now)` (called by a BullMQ repeatable job every 60 s, registered through
`ctx.worker`). Both claim rows with `select … for update skip locked` on the transaction's own
`EntityManager` (`em.execute`, never `getKnex()`), run the handler, and record the outcome. Failure:
`attempts + 1`, `last_error`, `next_attempt_at = now + min(1 min × 2^attempts, 1 h)`. There is no
terminal failed state. `sweep` is a plain async method so tests drive it without Redis, as
`RfqExpiryWorker.sweep` is.
*Rationale*: Principle X; FR-007, FR-010, FR-012. `skip locked` gives mutual exclusion between the
inline attempt, the sweep, and a second worker instance, which is what the stock release needs — it
has no row lock of its own, so two concurrent runs could both decrement `reserved`.
*Rejected*: **one BullMQ job per effect with BullMQ's retry** — retries exhaust, and the state would
live in Redis. **A setting for the interval** — nobody has asked to tune it. **Draining only in the
worker** — releases would become asynchronous for every caller, which changes behaviour that buyers
and tests observe today, and the shared test server composes no BullMQ.

**D7 — The announcement is emitted after the commit regardless of the attempt.**
*Decision*: `commit → drainForOrder → emitOrderStatusAfter`, with the emit in a `finally`.
*Rationale*: FR-011. Today a throwing hook suppresses the events that invoicing, webhooks and push
subscribe to. The order *drain, then emit* is kept so a subscriber that reads stock in its handler
sees what it sees today.
*Not done*: durability of the announcement (spec Q3).

**D8 — The payment-status twin uses the same table.**
*Decision*: `OrderService.transitionPaymentStatus` writes `paymentStatus`, the audit entry and a
`credit.release` row (reason `invoice_paid`) in one transaction, then drains.
*Rationale*: FR-005; the same defect, one method away.

**D9 — Repair is a declared operator command over two new read methods.**
*Decision*: `cliCommands` entry `transition-effects-repair` in `orders`' manifest, body in
`src/backend/cli/transition-effects-repair.ts`. It pages through candidates from `orders`' own
tables — `status = 'cancelled'`, or `payment_status = 'paid'` with a credit-limit snapshot, with no
effect row — asks the owners which of them hold anything, and prints the list. With `--apply` it
inserts effect rows (`origin = 'repair'`) inside one audited Command per page and drains them.
An absent owner is reported as *not examined*.
New reads, both in `@endora-commerce/contracts`:
- `InventoryStockReadPort.unreleasedAllocationsForOrderItems(orderItemIds: readonly string[]): Promise<Array<{ orderItemId: string; warehouseId: string; quantity: number }>>`
- `CreditLimitReadPort.activeReservationsForOrders(orderIds: readonly string[]): Promise<Array<{ orderId: string; amount: string; currency: string }>>`
*Rationale*: FR-016–FR-018; spec Q2, Q6. `orders` may not read `stock_allocations` or
`credit_limit_reservations`; the owners answer.
*Rejected*: **a migration or install hook that repairs** — a silent change to stock counters and
available credit on upgrade (Q2). **Raw SQL across the three modules' tables in a script** —
Principle I.

**D10 — Visibility is one optional field and one notice.**
*Decision*: the admin order response gains `pendingEffects?: Array<{ effect: 'stock.release' |
'credit.release'; blockedOn: string | null; attempts: number; lastAttemptAt: string | null }>`,
populated by `serializeOrder`; `OrderDetail.tsx` renders a notice from it using existing admin-kit
alert primitives.
*Rationale*: FR-019; Principle IX. No new screen, so no palette action and no permission code.

## Data model

Table **`order_transition_effects`** (owner `orders`; entity `OrderTransitionEffect`, `@OrgScoped`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `organization_id` | uuid not null | copied from the order; tenant filter (Principle XI) |
| `order_id` | uuid not null | FK → `orders.id`, same module |
| `effect` | text not null | `stock.release` \| `credit.release` (check constraint) |
| `reason` | text not null | `order_cancelled` \| `invoice_paid` |
| `origin` | text not null | `transition` \| `repair` |
| `attempts` | int not null default 0 | failed attempts only; a blocked pass does not count |
| `next_attempt_at` | timestamptz not null default now() | |
| `blocked_on` | text null | module id last found absent |
| `last_error` | text null | truncated message, never a stack |
| `last_attempt_at` | timestamptz null | |
| `result` | jsonb null | what the owner answered (`{ released: n }`, `{ ok, code }`) |
| `completed_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz not null | |

Indexes: unique `(order_id, effect) where completed_at is null` — at most one outstanding per order
and effect; `(next_attempt_at) where completed_at is null` — the sweep; `(order_id)` — the order
page.

The migration is scaffolded with `pnpm --filter backend run migration:new -- --module orders --name
order_transition_effects` and registered by `composer:generate`. It creates the table and nothing
else; it does **not** backfill (D9).

Which rows a transition writes:

| Transition | Rows |
| --- | --- |
| lifecycle `→ cancelled` | `stock.release` / `order_cancelled`, always; `credit.release` / `order_cancelled` when `mayHoldCreditLimitReservation(order)` |
| payment status `→ paid` | `credit.release` / `invoice_paid` when `mayHoldCreditLimitReservation(order)` |
| anything else | none |

`stock.release` is written even when `inventory` is off at that moment — that is the row that makes
row 3 of the spec's table recoverable.

## What changes in published surfaces

| Surface | Change | Compatibility |
| --- | --- | --- |
| Database | new table `order_transition_effects` | additive |
| `OrderTransitionPort`, `OrderTransitionOutcome` | none | — |
| `order.status_changed.v1` and templated events | none in shape; emitted in cases where they were suppressed | — |
| `POST …/orders/:id/status`, `…/bulk/status`, `…/payment-status`, `POST /orders/:id/cancel` | no shape change. **Behaviour**: with D4, a 503 after a committed status no longer occurs; a credit order is cancellable while `credit_limits` is off | a client that relied on the 503 sees 200 |
| Admin order response | `pendingEffects?` | additive, optional |
| `InventoryStockReadPort` | `+ unreleasedAllocationsForOrderItems` | additive for callers; **an implementer of the interface must add it** |
| `CreditLimitReadPort` | `+ activeReservationsForOrders` | same |
| `CreditLimitPort`, `InventoryReservationApplyPort` | none | — |
| `orders` manifest | two `whenAbsent` sentences, one `cliCommands` entry | — |

No breaking change for a consumer. The one break — for an implementer of the two read ports — is
called out in the changeset (spec Q4). Release as a **minor** of the four packages.

## Cross-cutting concerns

| Concern | Answer |
| --- | --- |
| Admin permissions | none new — the notice rides the order response behind `orders:read`; the repair is a CLI command |
| Command palette | none new — no new admin surface |
| i18n | `orders` bundle, `pl` + `en`: notice title, one line per effect, *waiting for module {module}*, *retrying* |
| Settings | none — the sweep interval and the back-off are constants (D6) |
| Auditing (Command Bus) | the status and payment-status writes keep their co-transactional `recordWithin` entries, unchanged. Executing an effect is a system operation recorded by the effect row and by the owner's own trail (`credit_limit.released.v1`, the reservation and allocation rows), as both release implementations already state. The repair's `--apply` is an operator write and runs through `CommandBus.run` |
| Tenant scoping | the effect entity is `@OrgScoped`; the sweep and the repair run under `withSystemScope`; the inline drain runs in the request's scope and reads only the order it just wrote |
| Sales-channel scoping | not applicable — no channel-scoped read |
| Cache invalidation | none new — the owners' release implementations are called unchanged |
| Module off-states | `inventory` off → `stock.release` waits; `credit_limits` off → `credit.release` waits (D4) or the transition is refused before the write (Q1 alternative); `orders` is `nonDeactivatable`, so its worker has no off state of its own |
| Documentation | `packages/modules/orders/docs/orders.md` (what a pending follow-up is, the repair command) and the upgrade note; `en` + `pl`; handed to the product owner |

## Constitution Check

| Principle | Verdict |
| --- | --- |
| I Modular (NN) | **Pass** — `orders` owns the table, the worker and the handlers; stock and credit are reached only through published ports; two reads are added to the owners' ports instead of querying their tables |
| II API-first | **Pass** — the two port methods and `pendingEffects` are added in `packages/contracts` first (T02) |
| III TDD (NN) | **Pass** — every task names its failing test first; the seven failure rows are the acceptance set |
| IV Minimal deps | **Pass** — none |
| VI Naming (NN) | **Pass** — migration scaffolded; `check:naming` |
| VIII English (NN) | **Pass** |
| IX UI reuse | **Pass** — existing alert primitive |
| X Queue consumers | **Pass** — BullMQ repeatable job through `ctx.worker`; `skip locked` for more than one consumer |
| XI Tenancy (NN) | **Pass** — `@OrgScoped`, system scope in the sweep |
| XII Channel scoping (NN) | **N/A** |
| XIII Command Bus (NN) | **Pass, with a standing deviation unchanged** — the transition's audit stays `recordWithin` on the transition's own transaction, as feature 054 left it; the new operator write (repair) uses the Command Bus |
| XVI Palette | **N/A** — no new admin surface |
| XVII Toggleable (NN) | **Pass** — off no longer loses a release; no owner table is written while its module is off; both manifest sentences become true |

**Verdict: passes.** One ruled behaviour is proposed for reversal and is raised, not assumed (Q1).

## Complexity tracking

| Addition | Why | Simpler alternative rejected |
| --- | --- | --- |
| a table and a worker in `orders` | the fact that a release is owed must outlive the request, the process and a module's off state | a pre-write check (D1 b) — leaves every post-write failure as it is today |
| two read methods on published ports | the repair must show what it will release before it releases it | apply-and-report (spec Q6) — an unbounded, unpreviewed write on stock and credit |

No new runtime dependency.

## Project structure (what changes)

```text
packages/contracts/src/inventory.ts                    + InventoryStockReadPort.unreleasedAllocationsForOrderItems
packages/contracts/src/credit-limits.ts                + CreditLimitReadPort.activeReservationsForOrders
packages/contracts/src/orders.ts                       + pendingEffects on the admin order response
packages/modules/inventory/src/backend/                the read's implementation
packages/modules/credit_limits/src/backend/            the read's implementation
packages/modules/orders/src/backend/entities/order-transition-effect.entity.ts        new
packages/modules/orders/src/migrations/<stamp>_orders_order_transition_effects.ts     new (scaffolded)
packages/modules/orders/src/backend/domain/transition-effects.ts                      which rows a transition owes (pure)
packages/modules/orders/src/backend/services/order-transition-effect-service.ts       record / drainForOrder / sweep
packages/modules/orders/src/backend/services/order-transition-effect-handlers.ts      stock.release, credit.release
packages/modules/orders/src/backend/workers/transition-effect-sweep-worker.ts         BullMQ repeatable
packages/modules/orders/src/backend/services/order-transition-service.ts              D5, D7; the hook parameter goes
packages/modules/orders/src/backend/services/order-service.ts                         transitionPaymentStatus (D8)
packages/modules/orders/src/backend/plugin.ts, index.ts                               wiring; ctx.worker
packages/modules/orders/src/backend/cli/transition-effects-repair.ts                  new
packages/modules/orders/src/manifest.ts                                               whenAbsent ×2, cliCommands
packages/modules/orders/src/backend/routes.ts                                         serializeOrder → pendingEffects
packages/modules/orders/src/admin/pages/OrderDetail.tsx                               the notice
packages/modules/orders/i18n/{en,pl}.json, docs/orders.md
backend/src/db/migrations-registry.generated.ts                                       regenerated
backend/test/integration/orders/…                                                     see tasks
```

## Handoff to `endora-commerce-dev`

Implement from [tasks.md](tasks.md) in order. Q1 and Q2 are answered (spec, *Open questions*).
The four items below were written as premises; **T01 measured each on `af6e32ab3`**, and what was
found replaces the premise:

1. **Holds.** An `effectiveState.isPresent('credit_limits')` decision in `orders`, placed before a
   `lazyPort` call on `creditLimitService` (the `refuses-without` edge), with the same shape for
   `inventory`, was run through `check:port-dependencies` (resolutions 1299 → 1302, `violations=0`,
   `non-binding-issues=0`), `check:entry-presence` (`violations=0`) and `check:port-catches`
   (`violations=0`), and through the ledger's own tests
   (`test/unit/kernel/port-dependency-check.test.ts`,
   `test/unit/_lifecycle/dead-activation-switches.test.ts`,
   `test/unit/orders/payments-deactivation-consequence.test.ts`) — all green. D3 and D4 stand.
   **One thing the measurement also showed**: `check:port-catches` does not see a `catch` around a
   closure that reaches the port two calls away — a negative control with the
   `rethrowIfModuleDisabled` line removed stayed at `violations=0`. So the first line of the
   per-row `catch` in T08 is held by the rule in `module-composition.md` item 7 and by T08's own
   test, not by that check.
2. **No precedent exists; the seam does.** None of the declared `cliCommands` bodies runs a Command
   (`search reindex` and `carts abandonment-sweep` read their own registrations off the cradle;
   `admin_users create` writes directly and says why). `CommandBus.run` resolves its actor from the
   ambient tenant context and refuses without one — and the host supplies one: the dispatcher
   (`packages/platform/src/cli/dispatch.ts`) runs every module command inside `enterSystemScope`
   over its own composition. So the repair body opens no scope of its own and reads `commandBus`
   off the cradle, where `orders` already resolves it; a system actor maps to a `null` admin id on
   the audit entry (`actorFromContext`). *This answer first said the host establishes no context;
   that was read off `runModuleCommand` alone, one frame below the dispatcher, and review corrected
   it.*
3. **The current shape is `product_feeds`' reaper** (`workers/feed-run-reaper-worker.ts`, the newest
   periodic worker): a BullMQ `Worker` whose processor runs inside `enterSystemScope`, a **Job
   Scheduler** installed with `queue.upsertJobScheduler(id, { … }, { name, data })` rather than a
   repeatable job, both built only when the host values `processRunsWorkers` and `moduleQueueRedis`
   say this process consumes queues, and the worker attached with
   `ctx.worker(worker, { logger: app.log })` inside the `ctx.routes(…)` body. The test kit sets
   `processRunsWorkers` to `false`, so the shared test server composes no consumer.
4. **There is no admin-specific schema.** `serializeOrder` returns `Record<string, unknown>` and is
   checked against nothing at runtime; the one schema describing the shape is `orderSchema` in
   `packages/contracts/src/orders.ts`, shared by the buyer-facing and the admin reads, which
   already carries a field present on one family only (`customerCancellable`, buyer reads).
   `pendingEffects` is added there the same way: optional, documented as admin-only, and T16
   asserts the buyer-facing response does not carry it.

## As built — where the tree led somewhere the plan did not

Each of these is a difference between what the decisions above say and what was implemented, with
the reason. None changes D1–D10's substance.

1. **`stock.release` shares a function with `OrderService.releaseAllocations` rather than calling
   it (D2).** `OrderService` is built in the plugin body, so it exists only once routes register —
   and the repair command composes the platform without building a server. The release body moved
   to `services/order-allocation-release.ts`; both callers use it, and
   `place-order-inventory-apply-port.test.ts`, which drives the service method, is green unedited.
2. **The effect service is a container registration, not a plugin-body object (D6).** For the same
   reason: the engine, the sweep worker and the repair command must reach one instance, and only
   the first has a server. `orderTransitionEffectService` is registered in `backend/index.ts` and
   handed to the plugin.
3. **The engine's fourth constructor argument stays, with a new meaning (T09).** T09 said to
   remove the `sideEffects` parameter. `status-lifecycle.test.ts` builds the engine with three
   arguments and SC-004 keeps it unedited, so the fourth is now the optional effect service — and
   it fails closed: a transition that owes a follow-up is refused, before the write, when none was
   supplied. `OrderService` takes the same collaborator the same way for D8.
4. **`record` is `insert … on conflict do nothing` on the partial index.** D5's lock makes two
   *lifecycle* transitions serialise, but an order marked paid whose credit release is still
   outstanding and which is then cancelled would otherwise trip the unique index inside the
   cancellation. One outstanding release per order and effect is owed once, whichever transition
   asks second.
5. **`order_transition_effects.organization_id` carries no foreign key.** `orders.organization_id`
   carries none, and `order-transition-port.test.ts` seeds orders whose organization has no row; a
   constraint on the copy refused the cancellation of an order the schema accepts.
6. **`sweep` writes `blocked_on` in bulk (D3).** D3 has the sweep exclude the rows of an absent
   owner and do nothing per row. It does — and issues one statement per absent owner marking
   not-yet-marked rows as waiting, and its mirror clearing the mark when the owner is back, so the
   order page's "waiting for module" stays true for a row the inline attempt never saw blocked.
   After the first pass both statements update nothing.
7. **A failure of the drain itself is tolerated in the request (FR-002).** D7 puts the emit in a
   `finally` and says nothing about the drain throwing for a reason other than D3's residue (the
   claim failing on a lost connection). The status is committed and the rows recorded, so the
   caller is answered "applied" and the failure is logged; `ModuleDisabledError` is re-thrown
   first, as D3 says. Fault 1 of the fault-injection test.
8. **The buyer cannot reach spec row 1** — measured, and corrected in the spec. T11's buyer
   assertion is made with an order the buyer may cancel.
9. **A second module edge: `credit_limits:creditLimitReadPort`, `degrades-without`.** D9 added the
   read method; resolving its port from `orders` is a new edge and is declared, with the degrade
   the repair implements (credit holdings reported as not examined).
10. **Strings: the notice's are in `orders`' own bundle**, as the plan says, although the rest of
    the order page still reads the legacy `core` namespace.
11. **Read sizes were not re-recorded (T19).** They are re-recorded at release now; the bands held.
13. **A claim is a committed lease, not a row lock (D6) — changed after review.** D6 claims rows
    with `select … for update skip locked` held around the handler. That holds one pooled
    connection per attempt while the release opens a second, and with more concurrent cancellations
    than the pool has connections every claim waits on a connection only another waiting claim
    could free. Measured through HTTP on a pool of 10: 30 at once took 123 s, 20 committed
    cancellations were answered 500 and no release completed. The claim is now one committed
    statement stamping `claimed_until` (a column of the same new table), the handler runs with
    nothing of the queue's open, and one statement records the outcome; the same 30 take under four
    seconds, all answered 200, all released. A lease nobody hands back expires after five minutes,
    and the stock release locks its order row for its own short transaction, so a second run
    overlapping a slow first one cannot decrement twice. The bulk `blocked_on` statements no longer
    have a held row lock to wait behind. `transition-effects-pool-pressure.test.ts` is the test.
14. **A response that cannot be read back after the commit is answered as a success.** The 500s
    above came from the status route's own reads for the response body. The three routes that reply
    after a committed transition answer what was written (`id`, `businessId`, `status`,
    `paymentStatus`) with `meta.partial` when the full order cannot be read (FR-002).
15. **A returned owner's rows are due at once (FR-008).** The statement that clears `blocked_on`
    also brings `next_attempt_at` forward, so a row that had failed before its owner went away
    drains in the first sweep after the owner returns rather than after its old back-off.
16. **The repair takes `--order=<id>` and `--except=<id>`.** The dry run cannot show that an
    operator already corrected a stock counter by hand for a listed order; the filters are how such
    an order is left out.

12. **Test-first was kept unevenly, and this is the honest account.** Run red before the
    implementation existed: T00's seven cases, T02, T03, T04 and T06 — and through T00, the
    mechanism tasks T09–T12, whose acceptance is those seven cases going green. Written before the
    implementation but not run red: T05 (its absence was observed as T00 row 5's missing relation),
    T13 and T17. Written together with or after their subject: T07, T08, T15, T16 and T20.

Also re-derive the spec's failure table against the tree you branch from; every row is a reading of
`fe0803f2e`. Branch off `origin/master`; regenerate and commit generated artefacts in the same pull
request (`composer:generate`); re-measure read sizes (this adds files); one changeset per touched
package; `git commit -s`; no AI attribution in commits or pull-request text.
