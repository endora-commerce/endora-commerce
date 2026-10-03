---
'@endora-commerce/mod-orders': minor
---

An order transition and its follow-up work can no longer come apart.

Cancelling an order releases its stock allocations and, for an order placed against a credit limit, its credit reservation; marking such an order paid releases the reservation. Those releases used to run after the new status had already been committed, so a release that failed or was refused left the order cancelled (or paid), answered the caller with an error, suppressed the status events — and could never be run again, because repeating the transition is a no-op.

**What changes**

- **A new table, `order_transition_effects`** (one migration, additive). The status, its audit entry and one row per release the transition owes are written in a single transaction, with the order row locked. The releases are attempted immediately afterwards, in the same request, so in the ordinary case nothing observable changes.
- **A release that cannot complete is retried instead of failing the call.** A BullMQ sweep worker (queue `orders.transition_effects.sweep`, every 60 seconds, in processes that run queue consumers) retries outstanding releases with a back-off from one minute up to one hour, with no terminal failed state. From the fifth failure on, each failure is logged at `warn`.
- **A switched-off module delays a release instead of losing or refusing it.** With `inventory` off, a cancelled order keeps its allocations and they are released within a minute of the module being switched back on. With `credit_limits` off, an order placed on credit can be cancelled or marked paid, and its reservation is released when the module returns.
- **The status events are emitted after every committed transition**, whatever happened to the releases.

**Behaviour a client may have relied on**

- `POST /api/v1/admin/orders/:id/status`, `POST /api/v1/admin/orders/bulk/status` and `POST /api/v1/admin/orders/:id/payment-status` no longer answer `503 MODULE_DISABLED` or `500` after having moved the order. For an order placed on credit while `credit_limits` is off they now answer `200`; the bulk route lists such an order under `changed`, and an order under `skipped` has not moved.
- The admin order responses carry an optional `pendingEffects` while a release is outstanding, and the admin order page shows a notice from it. No request, response, event or port shape that existed before changes.

**After upgrading: run the repair's dry run once**

Orders that an earlier version left cancelled or paid while still holding stock or credit have no follow-up row, so nothing releases them by itself. A new operator command finds them:

```bash
pnpm --filter backend run cli orders transition-effects-repair           # lists, writes nothing
pnpm --filter backend run cli orders transition-effects-repair --apply   # releases
```

Read the list before applying it: a release changes reserved-stock counters and available credit, and anything corrected by hand in the meantime is released on top of that correction. The repair never runs on its own.

**For a module author**: `OrderTransitionService`'s fourth constructor argument is no longer a side-effects callback but the service that records and runs follow-ups, and a transition that owes a follow-up is refused when none was supplied. `bullmq` joins the package's peer dependencies.
