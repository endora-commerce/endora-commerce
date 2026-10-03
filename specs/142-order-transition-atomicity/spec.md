# Feature Specification: an order transition and its follow-up work cannot come apart

**Feature directory**: `specs/142-order-transition-atomicity/`
**Created**: 2026-10-03
**Status**: Draft — six questions for the owner (see *Open questions*); Q1 and Q2 gate implementation
**Input**: two related defects on the order status seam. (1) A transition whose follow-up work
fails or refuses leaves the new status already committed. (2) A transition whose follow-up work did
not run can never run it, because repeating the transition is a no-op once the order is at the
target status. The follow-up work in question releases **stock** and **credit**.

## Why — what the code does today (measured on `origin/master` at `fe0803f2e`)

### The seam

| Fact | Where |
| --- | --- |
| `apply` loads the order, returns early when `from === to`, validates the graph, runs the before-guards, sets `order.status`, records the audit entry on the same `EntityManager`, **flushes**, and only then calls the side-effects hook; the `.after` events are emitted after the hook returns | `packages/modules/orders/src/backend/services/order-transition-service.ts` (lines 101, 135–149, 152) |
| The hook has one branch, `to === 'cancelled'`: release the credit-limit reservation if the order was placed on credit, **then** release the stock allocations | `packages/modules/orders/src/backend/plugin.ts` (lines 504–521) |
| The credit release opens its own transaction, locks the reservation, and is idempotent (`ALREADY_RELEASED`, `RESERVATION_NOT_FOUND` are values); it takes no caller transaction | `packages/modules/credit_limits/src/backend/services/credit-limit-service.ts` (`releaseByOrder`), `packages/modules/credit_limits/src/ports/index.ts` (`CreditLimitPort`) |
| The stock release opens its own transaction, is idempotent by `released_at is null`, and **returns `{ released: 0 }` without doing anything when `inventory` is switched off** | `packages/modules/orders/src/backend/services/order-service.ts` (`releaseAllocations`), `packages/modules/inventory/src/backend/services/inventory-reservation-apply-port.ts` (`releaseForOrderItems`) |
| No caller wraps `apply` in a transaction. The published port says the opposite is required: *call this after your own commit, never inside your transaction*, because `apply` obtains its own `EntityManager` | `packages/contracts/src/orders.ts` (`OrderTransitionPort`), `packages/platform/src/kernel/container.ts` (`emFactory` forks) |
| The money axis has a twin: `transitionPaymentStatus` sets `paymentStatus`, records the audit entry, flushes, and then releases the credit reservation when `to === 'paid'` | `packages/modules/orders/src/backend/services/order-service.ts` (lines 2087–2125) |
| No before-guard is registered by any module; the veto registry is empty in every composition | `grep onOrderTransitionGuard(` — the declaration is the only hit |

### Who reaches it

| Caller | Actor | Path |
| --- | --- | --- |
| Admin, one order | operator | `POST /api/v1/admin/orders/:id/status` → `apply` (`routes.ts`) |
| Admin, bulk | operator | `POST /api/v1/admin/orders/bulk/status` → `apply` per order, a throw reported as `skipped` (`routes.ts`, `classifySkip`) |
| Admin, prompt actions | operator | `orders.set_order_status`, `orders.bulk_set_order_status` → `apply` (`prompt-tools.ts`) |
| Admin, payment status | operator | `POST /api/v1/admin/orders/:id/payment-status` → `transitionPaymentStatus` (`routes.ts`) |
| **Buyer** | customer | `POST /api/v1/orders/:id/cancel` → `CustomerOrderCancellationService.cancelByCustomer` → `orderTransitionPort.applyStatus` → `apply` (`order-cancellation-service.ts`) |
| Payment settlement (every gateway's webhook and return) | system | `ReceivePaymentHandler.receive` commits the payment, then `applyStatus` to the method's configured `statusOnSuccess` / `statusOnFailure` — operator-configurable, so it may be `cancelled` (`packages/modules/payments/src/backend/services/receive-payment-handler.ts`) |
| Carrier events | system | `ReceiveShipmentHandler` → `applyStatus` (`packages/modules/shipments/src/backend/services/receive-shipment-handler.ts`) |
| Integration modules distributed outside this repository | system | call `applyStatus` and treat `already_there` as success; subscribe to `order.status_changed.v1`. None writes `order.status` itself |

So the seam is buyer-reachable, and three of its callers already treat *"the order is at the target
status"* as success.

### What a failure leaves behind today

| # | Trigger | Status / audit | Credit | Stock | `.after` events | Caller is told | A repeat |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Cancel an order placed on credit while `credit_limits` is off | `cancelled`, committed | held | **held — never attempted** | **not emitted** | 503 `MODULE_DISABLED` | no-op, `already_there` |
| 2 | Cancel; the credit release throws for any other reason (lock timeout, lost connection) | `cancelled`, committed | held | held — never attempted | not emitted | 500 | no-op |
| 3 | Cancel while `inventory` is off | `cancelled`, committed | released | **held, silently** | emitted | success | no-op — and nothing runs when `inventory` returns |
| 4 | Cancel; the stock release throws | `cancelled`, committed | released | held | not emitted | 500 | no-op |
| 5 | The process dies after the flush | `cancelled`, committed | held | held | not emitted | connection reset | no-op |
| 6 | Any of 1, 2, 4 on the bulk route | as above | as above | as above | as above | the order is listed under `skipped` (or the batch stops with 503) although its status moved | no-op |
| 7 | Mark paid (payment status) an order placed on credit while `credit_limits` is off | `paymentStatus = paid`, committed | held | — | — | 503 | re-runs the release (this path has no early return) |

*Corrected in T00/T11 (measured)*: row 1 read "503 `MODULE_DISABLED` (the buyer included)". The
buyer does not reach row 1: an order placed on credit is `deferred`, which the buyer-cancellation
predicate does not count as "the buyer still owes", so `POST /api/v1/orders/:id/cancel` refuses it
with a 4xx before the seam, whatever state `credit_limits` is in. The buyer does reach rows 3 and
4 — an order they may cancel holds stock. The other six rows, and the rest of row 1, reproduced as
written.

Two of these contradict what the platform tells an operator. `orders`' manifest says of
`credit_limits` being off: *"an order that drew one can be neither cancelled nor marked paid"* —
rows 1 and 7 show it **is** cancelled and marked paid. It says of `inventory` being off: *"a
cancelled order releases none until the module is switched back on"* — row 3 shows nothing releases
it then either.

Holding stock and credit is the conservative direction — nothing is oversold and no credit is
overstated — but it is permanent: reserved stock that no order will ever ship, and available credit
that stays understated until someone edits the rows by hand.

## User Scenarios & Testing

### User Story 1 — A cancellation always ends with its stock and credit released (Priority: P1)

Whoever cancels an order — a buyer, an operator, a payment or carrier event, an integration — the
order's stock allocations and its credit reservation are released, either by the time the call
returns or, if something prevented that, automatically afterwards without anyone repeating the
cancellation.

**Why this priority**: it is the defect. Stock and credit are the two things a cancellation exists
to give back.

**Independent test**: cancel an order while the credit release is made to fail once; the call
reports the cancellation, and a moment later the reservation and the allocations are released with
no further request.

**Acceptance scenarios**

1. **Given** an order with stock allocations placed on credit, **When** it is cancelled and nothing
   fails, **Then** the call returns with status `cancelled`, allocations released, reservation
   released, and the status events emitted — as today.
2. **Given** the same order, **When** the credit release fails with a transient error, **Then** the
   stock is still released, the order is `cancelled`, the caller is told the cancellation succeeded,
   the status events are emitted, and the credit release is retried until it succeeds.
3. **Given** the process stops after the status is committed and before any release ran, **When** a
   backend process is running again, **Then** both releases happen without a new request.
4. **Given** an order already `cancelled` whose releases are outstanding, **When** the cancellation
   is requested again, **Then** the answer is `already_there` and that answer is *true*: the
   outstanding releases are recorded and will run.
5. **Given** a transition the graph refuses or a before-guard vetoes, **When** it is requested,
   **Then** nothing is written — no status, no audit entry, no follow-up — as today.

### User Story 2 — A switched-off module delays a release; it does not lose it (Priority: P1)

An operator has switched `inventory` or `credit_limits` off. Orders cancelled meanwhile are
cancelled. When the module is switched back on, what those orders held is released without the
operator doing anything else.

**Why this priority**: Principle XVII — off is non-destructive and reversible. Today off silently
converts a release into a permanent hold.

**Independent test**: switch `inventory` off, cancel an order, observe the allocations untouched and
one outstanding follow-up; switch `inventory` on, wait one sweep, observe the allocations released.

**Acceptance scenarios**

1. **Given** `inventory` is off, **When** an order is cancelled, **Then** the order is `cancelled`,
   no `inventory` table is written, and a stock release is recorded as waiting on `inventory`.
2. **Given** that order, **When** `inventory` is switched on, **Then** within one sweep interval the
   allocations are released and the follow-up is complete.
3. **Given** `credit_limits` is off and an order was placed on credit, **When** it is cancelled or
   marked paid, **Then** the outcome is as Q1 decides — recommended: the transition proceeds and the
   credit release waits on `credit_limits`; alternative: the transition is refused **before**
   anything is written. In neither outcome is a status written and a 503 answered.
4. **Given** a module is off for months, **When** the sweep runs, **Then** the rows waiting on it
   cost the sweep nothing per row.

### User Story 3 — Orders already stranded can be found and repaired (Priority: P2)

An operator upgrading a shop that has run the current code can list the orders that are cancelled
(or paid) and still hold stock or credit, see exactly what a repair would release, and run it.

**Why this priority**: the fix stops new strandings; this clears the ones that exist. It is P2 only
because it is run once.

**Independent test**: create a cancelled order with unreleased allocations by writing the rows
directly; the dry run lists it with its quantities and changes nothing; the applied run releases it;
a second applied run finds nothing.

**Acceptance scenarios**

1. **Given** stranded orders exist, **When** the repair is run without `--apply`, **Then** it prints
   each order, what it holds, and writes nothing.
2. **Given** the same, **When** run with `--apply`, **Then** each holding is released through the
   same follow-up mechanism as a live cancellation, and the run is audited.
3. **Given** a module is off, **When** the repair runs, **Then** it says that module's holdings were
   not examined, and exits successfully for the rest.
4. **Given** nothing is stranded, **When** the repair runs, **Then** it reports zero and writes
   nothing.

### User Story 4 — An operator can see that an order's follow-up is outstanding (Priority: P3)

On an order's admin page, an operator sees when a release has not happened yet, what it is waiting
for, and — when it keeps failing — that it needs attention.

**Why this priority**: a retry nobody can see is a second way to be surprised by the same state.

**Acceptance scenarios**

1. **Given** an order with a release waiting on a switched-off module, **When** the operator opens
   it, **Then** a notice names the release and the module, in Polish or English.
2. **Given** an order with no outstanding follow-up, **Then** there is no notice.

### Edge Cases

- **Two cancellations of one order at once** (a buyer and an operator): exactly one status write,
  one audit entry, one set of follow-ups; the other caller is answered `already_there`.
- **The inline attempt and the sweep meet on one follow-up**: one of them runs it; the release is
  not applied twice.
- **A follow-up ran and the process died before recording that**: it runs again; both releases are
  idempotent, so the second run changes nothing.
- **A module is switched off between the status write and the release**: the release waits; nothing
  is written to that module's tables.
- **An order with no allocations and no reservation** (placed while `inventory` was off, not on
  credit): its follow-ups complete as no-ops.
- **An order cancelled after an operator corrected a stock counter by hand**: the release clamps at
  zero as it does today; the repair's dry run exists so this is seen before it is applied.
- **A deployment adds its own terminal statuses**: follow-ups are keyed to the `cancelled` system
  status exactly as the hook is today; this feature does not widen that.

## Requirements

### Functional Requirements

**The write**

- **FR-001** A lifecycle transition MUST commit the new status, its audit entry and a durable record
  of every follow-up the transition owes in **one** transaction. None of the three may exist without
  the others.
- **FR-002** Nothing that can refuse or fail MAY run between that commit and the caller's answer in
  a way that changes the answer: once the transition is committed the caller MUST be told it was
  applied.
- **FR-003** Every refusal — unknown status, no such edge, terminal source, a before-guard's veto,
  and (if Q1 is answered *refuse*) an absent module — MUST happen before anything is written.
- **FR-004** Two concurrent transitions of one order MUST serialise: the second observes the first's
  result and is answered as a fresh call would be.
- **FR-005** The payment-status change to `paid` MUST follow FR-001–FR-003 for the credit release
  it owes.

**The follow-up**

- **FR-006** A recorded follow-up MUST be attempted immediately after the commit, in the same
  request, so that in the ordinary case stock and credit are released by the time the caller is
  answered — the behaviour callers observe today.
- **FR-007** A follow-up that did not complete MUST be retried by a background consumer until it
  completes, with a capped back-off, with no terminal *given up* state, and without depending on any
  state outside the database to know that it is owed.
- **FR-008** A follow-up whose owning module is switched off MUST wait without consuming an attempt
  and without writing that module's tables, and MUST run within one sweep interval of the module
  returning.
- **FR-009** Follow-ups of one order MUST be independent: one failing or waiting MUST NOT prevent
  another from running. (Today a refused credit release prevents the stock release.)
- **FR-010** A follow-up MUST be safe to run more than once, and MUST NOT run concurrently with
  itself.
- **FR-011** The status events (`order.status_changed.v1` and the templated `.after` events) MUST be
  emitted after the commit whatever the immediate attempt's outcome.
- **FR-012** The background consumer MUST follow the platform's queue-consumer pattern
  (Principle X), run under a system tenant scope, and tolerate more than one instance.

**Boundaries**

- **FR-013** `orders` MUST reach stock and credit only through the ports `inventory` and
  `credit_limits` publish. No entity, table or service of either is imported or queried.
- **FR-014** With a module off, `orders`' manifest sentence for that edge MUST describe what
  actually happens.
- **FR-015** No published request, response, event or port **shape that exists today** changes
  incompatibly. Additions are listed in the plan and released as a minor.

**Repair**

- **FR-016** An operator command MUST list orders at `cancelled` that still hold stock or credit,
  and orders with `paymentStatus = paid` that still hold credit, with what each holds, writing
  nothing unless asked to apply.
- **FR-017** Applying MUST release through the same follow-up mechanism (FR-006–FR-010), MUST be
  idempotent, and MUST be audited.
- **FR-018** The repair MUST NOT run by itself on upgrade (Q2).

**Visibility**

- **FR-019** The admin order page MUST show outstanding follow-ups: which release, whether it is
  waiting on a module, and how many attempts have failed; strings in `pl` and `en`.
- **FR-020** A follow-up that has failed five times MUST be logged at `warn` with the order id, the
  release and the last error, on every later failed attempt.

### Key Entities

- **Order transition effect** — one follow-up one transition owes: the order, which release, why
  (cancelled / invoice paid), whether it has completed, how often it was attempted, when to try
  next, the last error, and what it released. Owned by `orders`; tenant-scoped through the order's
  Organization.

## Non-goals

- **Making the status announcement durable.** `order.status_changed.v1` stays an in-process emit
  after the commit; a process that dies between the two still loses it (Q3).
- **Routing the transition through `CommandBus.run`.** The status write stays audited
  co-transactionally as it is; undo of a cancellation is not introduced.
- **A public contribution point for third-party transition effects.** Two effects exist; neither
  needs one.
- **Re-reserving stock or credit when a deployment's graph lets an order leave `cancelled`.**
- **Releasing a credit reservation when the *lifecycle* status becomes `paid`.** Only the payment
  status does that today; this feature keeps it so and records the asymmetry.
- **Refunding money on cancellation.** No refund is on this seam today and none is added.
- **The settlement port's own `paid` write** *(known gap, recorded during review)*.
  `OrderPaymentStatusApplyPort.applyPaymentStatus`, which `payments` calls inside its settlement
  transaction, can still set `paymentStatus = 'paid'` on an order placed on credit without locking
  the order and without recording a `credit.release` follow-up. It predates this feature and is
  outside FR-005, which covers the admin payment-status change; the reservation of such an order is
  found and released by the repair command.

## Success Criteria

- **SC-001** For each of rows 1–7 of *What a failure leaves behind today*, a test reproduces the
  trigger and shows: no status without its follow-up record, the caller told the truth, and the
  release completed without a second request once the cause is removed.
- **SC-002** With a failure injected at every point between the commit and the last release, no
  cancelled order holds stock or credit after the cause is removed and two sweep intervals pass.
- **SC-003** The repair's dry run on a database with *n* stranded orders lists exactly *n*; after
  `--apply` and a drain it lists zero.
- **SC-004** No existing test of cancellation, credit release or stock release changes its
  assertions about *what* is released; only tests that asserted a 503 after a committed status do.

## Open questions

Each has a recommended answer; the plan and tasks are written to the recommendations. **Q1 and Q2
gate implementation** — the tasks that depend on them say so.

**Answered by the owner on 2026-10-03: all six as recommended.** Q1 — proceed and defer (so T11
stands and T11a is not taken); Q2 — an operator command, dry-run by default; Q3 — no, a known gap
and its own feature; Q4 — yes, as a minor, with the implementer compile break stated in the
changeset; Q5 — in, on the order page only; Q6 — no, the dry run stays. The questions are kept
below as the record of what was decided and why.

1. **With `credit_limits` off, should cancelling (or marking paid) an order placed on credit be
   refused, or proceed and release the credit when the module returns?** An earlier ruling keeps the
   refusal, on the ground that the credit cannot be given back while its owner is absent. With a
   durable follow-up it can be given back *later*, which removes that ground.
   **Recommended: proceed and defer.** A buyer is not answered 503 for cancelling their own order
   because of a switch an operator flipped; `credit_limits` and `inventory` then behave alike; a
   held reservation harms nobody while the module is off, since no order can be placed on credit
   meanwhile. Placement on credit keeps refusing. *If the answer is "refuse"*: the refusal moves
   before the write (task T11a replaces T11) and the manifest sentence stays as it is.

2. **Should orders already stranded be repaired automatically on upgrade, or by an operator
   command?** **Recommended: an operator command, dry-run by default, named in the upgrade notes.**
   The repair changes reserved-stock counters and available credit; an operator who corrected
   either by hand should see the list before it is applied.

3. **Should the status announcement (`order.status_changed.v1`) become durable in this feature?**
   It reaches invoicing, webhooks and push notifications, and is lost if the process dies between
   the commit and the emit. Making it durable makes it at-least-once for every subscriber, including
   ones outside this repository. **Recommended: no — record it as a known gap and take it as its own
   feature**, because it changes delivery semantics platform-wide.

4. **Is a schema addition and two additive port methods acceptable in the next minor of the public
   packages?** One new table owned by `orders`; one read method each on `InventoryStockReadPort`
   and `CreditLimitReadPort` (for the repair's dry run); one optional field on the admin order
   response. Nothing existing changes shape, but **anyone implementing those two port interfaces —
   a test double, an alternative owner — must add the method**, which is a compile break for them.
   **Recommended: yes, as a minor, with that sentence in the changeset.**

5. **Is the admin notice (User Story 4) in this feature or later?** **Recommended: in**, kept to the
   order page; no list filter, no new screen, no new permission.

6. **May the repair's dry run be dropped to avoid the two port additions in Q4?** Then the repair
   would enqueue a release for every cancelled order ever and report afterwards what it found.
   **Recommended: no** — an unbounded write with no preview, on stock and credit, is the wrong
   trade for two read methods.
