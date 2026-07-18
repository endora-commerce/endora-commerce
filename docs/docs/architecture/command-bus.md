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

## Reversibility & undo

A command may capture per-record before/after state so an operator can **undo** it.
The bulk product edit (feature `022`) stores a `RevertRecord[]` on
`catalog_bulk_operations`; `POST /admin/catalog/bulk-operations/:id/undo` restores every
product whose current state still matches the operation, **refuses any record changed
since with a conflict report** (never a silent clobber), is idempotent-safe on
re-invocation, and audits the undo itself. Irreversible edits (e.g. category-bridge
changes) are marked non-reversible and offer no undo.

## Coverage check

A CI check (`scripts/check-command-coverage.ts`, report-only during the incremental
rollout) flags a sensitive mutation that neither runs through a registered Command nor
records an audit entry, and flags a write that both runs a Command **and** audits by
hand (the double-audit shape). It becomes build-breaking per module as each module's
writes are converted.

## Converting a write

Extract the pure write onto the transactional `em`, keep the legacy method
byte-identical for un-migrated callers, and add an audited entry point that runs a
Command; delete the prior manual audit call in the same change. See the feature
quickstart (`specs/054-command-bus-audit-undo/quickstart.md`) for the full pattern.
