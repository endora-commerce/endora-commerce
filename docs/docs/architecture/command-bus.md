---
title: Command Bus (Uniform Write Auditing & Undo)
---

# Command Bus

Sensitive writes are audited by a **framework-level command path**, not by
hand-placed audit calls (Constitution Principle XIII, feature `054`). A sensitive
mutation — a create/update/delete of a domain record — runs as a named **Command**
through the `CommandBus`, which is the single, guaranteed writer of its audit entry.
Services in migrated modules never call the audit writer directly.

## What running a Command guarantees

Running `commandBus.run(command)` performs, inside **one** scoped-fork transaction:

1. resolves the actor from the ambient `TenantContext` (fail-closed — no context ⇒
   it throws before any write; the actor is never taken from a request body);
2. captures before-state, performs the write on the transactional `em`, and records
   **exactly one** audit entry co-transactionally;
3. buffers the optional domain event and dispatches it **once on commit**.

So a committed command records one audit row and emits its event once; a rolled-back
command records no audit row and emits no event. The write, the audit entry, and the
event can never disagree.

## Anatomy of a Command

```ts
interface Command<TResult> {
  action: string;         // dot-namespaced, e.g. 'product.update', 'credit_limit.adjust'
  objectType: string;     // e.g. 'product'
  objectId: string;
  capture?(ctx): Promise<AuditState>;                 // optional pre-state
  run(ctx): Promise<{ result: TResult; before?; after?; skipAudit? }>;
  event?(result): CommandEvent | undefined;           // dispatched once on commit
}
```

`skipAudit: true` lets a command that decided **not** to mutate commit without an
audit row (a no-op business outcome), keeping "no write ⇒ no audit" honest.

## Two audit paths

Two sanctioned mechanisms satisfy the coverage guarantee; both write **one**
co-transactional audit entry and derive the actor from the ambient `TenantContext`:

- **`CommandBus.run(command)`** — owns its own scoped-fork transaction. Use it when
  the write can be expressed as a self-contained unit of work (the default, and the
  only path that supports reversibility/undo and buffered domain events).
- **`recordAuditFromContext(auditLog, em, input)`** — the lightweight companion
  (`backend/src/commands/audit-from-context.ts`). It records the audit entry on an
  `em` the caller already owns, committed by the caller's existing `flush()`. Use it
  when a write already runs inside its own transaction or `persistAndFlush(...)` and
  cannot be wrapped in the bus's transaction without restructuring. The actor is
  best-effort here: with no ambient context (e.g. a pre-auth self-registration or a
  worker path) it records null actor ids rather than throwing, so background writes
  still audit. Callers that *must* have an actor use the bus.

Most module writes use a small private `#audit(em, action, objectId, before, after)`
helper that delegates to `recordAuditFromContext`, keeping the audit call one line at
each write site.

## Reversibility & undo

A command may capture per-record before/after state so an operator can **undo** it.
The bulk product edit (feature `022`) stores a `RevertRecord[]` on
`catalog_bulk_operations`; `POST /admin/catalog/bulk-operations/:id/undo` restores every
product whose current state still matches the operation, **refuses any record changed
since with a conflict report** (never a silent clobber), is idempotent-safe on
re-invocation, and audits the undo itself. Irreversible edits (e.g. category-bridge
changes) are marked non-reversible and offer no undo.

## Auditable write vs. escape hatch

Not every mutation is an audited domain event. A write is classified as one of:

- **Audited** — an operator- or customer-initiated change to a durable domain record
  (create/update/delete of catalog/orders/pricing/organizations/…), a security event
  (password/role/MFA change, API key), or financial config (tax, promotion). These run
  a Command or `recordAuditFromContext`.
- **Escape-hatched** — a write that is *not* an audited domain event, marked with a
  `command-coverage-ignore: <reason>` comment inside the method. Recognized categories,
  each documented at the call site:
  - **transient working state** — carts, wishlists/shopping lists, cart coupon state
    (the resulting order/RFQ captures the audited durable record);
  - **telemetry** — analytics ingestion, search-phrase recording, engagement tracking;
  - **auth/session infrastructure** — session lifecycle, `lastLoginAt`/`lastUsedAt`
    bookkeeping (session state is owned by `SessionService`);
  - **delivery/execution & provider sync** — email/newsletter dispatch, webhook
    replay/delivery, Stripe/payment/shipment provider-event ingestion and mirroring
    (the order/payment status *transitions* they drive are audited in the orders flow);
  - **idempotent boot reconcilers/seeds** — settings/actions/CMS-hook/dictionary
    reconcilers and default seeders (system-invariant repairs, not operator writes).

The rule of thumb: audit the durable, operator-attributable state change; escape-hatch
transient, telemetry, infrastructure, and derived/sync writes — always where the
auditable event is captured elsewhere, and always with a one-line reason.

## Coverage check (CI-enforced)

`scripts/check-command-coverage.ts` statically flags, per method in every
`modules/*/services/*.ts` file, a sensitive mutation (`persist*`, `nativeUpdate`,
`nativeDelete`, `remove*`, `flush`) that is neither audited nor escape-hatched, and the
**double-audit** shape (a method that both runs a Command and audits by hand). A method
counts as covered when it runs a Command, defines a Command literal, records audit
(`auditLog.record`/`recordWithin`, `recordAuditFromContext`, or a `.audit` recorder),
delegates to such a method (`this.<runner>()`), is itself a helper invoked by a covered
method (reverse delegation), or carries a `command-coverage-ignore` comment.

The platform-wide rollout is **complete** — all backend modules are migrated (207
registered command actions, ~120 documented escape hatches). CI runs the check with
`--strict` in the `quality` stage, so **any** finding in **any** module — including a
brand-new module — fails the build. Coverage cannot silently regress.

### The escape hatch is swept for staleness

185 methods carry the ignore comment, and until issue #116 nothing ever re-read one: an
ignore written for a write that has since moved — into a Command, or into another
module's audited service — went on exempting a method that no longer needed exempting,
and the next write added there inherited the exemption in silence. A marker on a method
that **no longer writes at all** is now reported as `stale-ignore` and fails the build,
so the hatch is a two-way ratchet like every other ledger in the repository. Four were
found on the first run, all four in payment-gateway services whose local mirroring had
moved into `ReceivePaymentHandler`; their prose stayed as ordinary comments.

The staleness half deliberately looks for writes **more widely** than the flagging half —
it also counts a raw SQL write statement and any write reached through `this.<name>(…)`
in the same file — so a marker guarding a real write the check cannot itself see is left
alone. Both errors then fall on the safe side: at worst a marker outlives its write for
one more refactor, never the reverse.

## Converting a write

For a Command: extract the pure write onto the transactional `em` and run it through
`commandBus.run(...)`; delete any prior manual audit call in the same change (avoid the
double-audit shape). For the lightweight path: add the `#audit(...)` helper delegating
to `recordAuditFromContext` and call it immediately before the method's `flush()`. For
a non-audited write: add a `command-coverage-ignore: <reason>` comment. Register every
new Command action in `backend/src/commands/command-registry.ts`. See the feature
quickstart (`specs/054-command-bus-audit-undo/quickstart.md`) for the full pattern.
