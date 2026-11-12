---
title: Command Bus (uniform write auditing & undo)
---

# Command Bus

Sensitive writes are audited by a **framework-level command path**, not by
hand-placed audit calls. A sensitive
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
  hookData?(result): unknown;                         // required when the action is hookable
  outboxData?(result): OutboxData;                    // afterCommit data, ids and codes only
  extensions?: Record<string, unknown>;               // caller input for hook modules, by module id
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
  (`packages/platform/src/commands/audit-from-context.ts`). It records the audit entry on an
  `em` the caller already owns, committed by the caller's existing `flush()`. Use it
  when a write already runs inside its own transaction or `persistAndFlush(...)` and
  cannot be wrapped in the bus's transaction without restructuring. The actor is
  best-effort here: with no ambient context (e.g. a worker path that opened none) it
  records null actor ids rather than throwing, so background writes still audit.
  Callers that *must* have an actor use the bus. An anonymous request is not such a
  path: it carries the system context, so a pre-auth write such as a storefront
  self-registration runs as a Command (`organization.register`) with a null actor.

Most module writes use a small private `#audit(em, action, objectId, before, after)`
helper that delegates to `recordAuditFromContext`, keeping the audit call one line at
each write site.

## What an audit entry holds

The audit log is one platform-wide table, read under one permission (`audit_log:read`)
regardless of which Organizations the reader may see. So for a **tenant-scoped record** (an
`@OrgScoped`, `@CustomerScoped`, `@TransitivelyScoped` or `@RuleScoped` entity) a Command's
before/after state carries **names and structure, never values**: ids, document numbers, status
and other codes, booleans, counts, dates, and `changedFields` / `changedCustomFields` listing what
changed. Titles, descriptions, amounts, custom-field values, personal data and the record's own
Organization or Customer Account id stay out of it. A module whose record history shows values
keeps them in a store of its own, written in the same Command and read only through the record's
scoped access path; the audit entry points at that row by `valueChangeId`. Platform-global
records (catalog, settings, dictionaries) may still record values. The rule and its test
obligation are `specs/conventions/audit-state.md` in the repository (issue #470).

## Command hooks (`beforeCommit`) {#command-hooks-beforecommit}

A module can take part in **another module's write** without forking it, but only in a write
the owning module has opened to hooks. The owner **declares** a Command action hookable: it
publishes a typed reference in `@endora-commerce/contracts` and lists it in its manifest's
`hookableActions`. `organizations` declares four (see its module page). Any module — a core
module, a deployment's overlay module or an installed package — then registers a hook:

```ts
import { ORGANIZATION_HOOKABLE_ACTIONS as ORG } from '@endora-commerce/contracts';
import { CommandHookRefusal } from '@endora-commerce/platform/commands';

export function registerModule(ctx: ModuleContext): void {
  ctx.commandHooks([
    {
      id: 'refuse-unserved-country',
      on: ORG.register,
      phase: 'beforeCommit',
      handler: ({ data }) => {
        if (!SERVED.has(data.organization.registeredAddress.country)) {
          throw new CommandHookRefusal(409, ACME_COUNTRY_NOT_SERVED, 'We do not serve this country.');
        }
      },
    },
  ]);
}
```

**When it runs.** Inside the Command's transaction, after the owner's `run` and before the
owner's audit entry: `capture → run → hooks → audit entry → event → commit`. The hook gets the
owner's declared `data` (typed by the ref, reflecting the uncommitted write), the same `em`
and actor, and `ctx.run(child)` to run a Command of its own or another owner's on the same
transaction, with that child's own audit entry.

**Veto.** A hook refuses by throwing an `HttpError` with a code its own module declares and
translates (`CommandHookRefusal` is a readable subclass). The whole Command rolls back — the
owner's row, every child, every entry and the event — and the caller gets that status and
code. Any other throw rolls back too and answers `500`.

**What a hook writes is named in the owner's one entry.** A hook that writes its own tables
calls `ctx.noteAuditChanges(['x_acme_erp_code'])`, and the owner's entry gains
`stateAfter.extensions.<moduleId>.changedFields`. Names only: the bus refuses anything that
is not a field name, so the names-only audit rule holds for hooks too. Notes force the entry: if
the owner answered `skipAudit` but a hook noted a write, one entry is still recorded, with
`stateBefore: null` and `stateAfter: { extensions }`.

**Extension input.** A caller may pass `extensions: { <moduleId>: … }` on the Command. Each
hook sees only its own module's slice as `ctx.extension` and validates it itself. A key no
present hook module on that action claims is refused `422 COMMAND_EXTENSION_UNCLAIMED` before
anything is written, so a misspelt or switched-off module never loses data silently.
`currentCommandHookOrigin()` tells code on the hook's async path which hook is running.

**Off means off.** A hook whose module is switched off — on either presence axis — is skipped
for that Command, decided per call, with no restart. The write behaves as if the module were
not installed.

**Composition refuses what cannot be ordered or is not offered.** At boot, after every module
has registered and before any boot hook, the platform refuses: a hook on an action no module
declares; a phase the owner does not offer; one action declared by two modules; a duplicate
hook id within a module; a hook module whose manifest `dependencies` do not reach the owner;
and two hook modules on one action with no dependency path between them. Hooks run in
dependency order (a module after every module it depends on, a module's own hooks in
registration order). When two modules are unrelated, the deployment orders them in its
`divergence.ts`:

```ts
commandHookOrder: { 'organization.register': ['acme_erp', 'acme_crm'] }, // first runs first
```

An entry that contradicts a dependency is refused. Hooks appear in the deployment's divergence
report as `command-hook`, and `GET /api/v1/admin/command-hooks` (behind
`platform.modules.read`) serves the live execution plan.

**Rules for hook authors.** Write only your own module's tables, or run the owner's Command
through `ctx.run` — never another module's table. Make no remote call: the transaction is
open and a slow hook holds the owner's row locks. A hook nesting Commands that reappear in
their own chain, or nesting deeper than eight, is refused `500 COMMAND_HOOK_CYCLE`.

**Rules for owners.** Declare only a Command whose `run` is complete and which is not
reversible (undo restores only what the owner captured). Supply `hookData` — the bus refuses a
hooked Command without it (`500 COMMAND_HOOK_DATA_MISSING`) — and `outboxData` for the
`afterCommit` phase (refused the same way), and hold each declared Command to its ref with `expectHookableCommand`
from `@endora-commerce/test-kit/command-hooks`. The action string, the phases and the data
types are a public contract.

## After the commit: `afterCommit` handlers and the outbox {#aftercommit-outbox}

Work that must happen **after** an owner's write — telling an ERP that an Organization
registered, say — goes in an `afterCommit` handler on the same declared action. It is
registered through the same `ctx.commandHooks` call, and it is never run inside the write:

```ts
import { ORGANIZATION_HOOKABLE_ACTIONS as ORG } from '@endora-commerce/contracts';
import { PermanentOutboxFailure } from '@endora-commerce/platform/commands';

ctx.commandHooks([
  {
    id: 'notify-erp',
    on: ORG.register,
    phase: 'afterCommit',
    handler: async ({ messageId, data, causation }) => {
      const answer = await erp.registered(data.organizationId, { idempotencyKey: messageId });
      if (answer.rejected) throw new PermanentOutboxFailure('acme-erp-rejected', answer.reason);
    },
  },
]);
```

**Written in the owner's transaction.** For each present `afterCommit` handler, the Command
Bus writes one row into the platform's `command_outbox` table on the Command's own `em`,
after the audit entry: `capture → run → hooks → audit entry → event → outbox rows → commit`.
The rows commit with the write or not at all — a rolled-back Command leaves none — and a
handler whose module is switched off gets no row. This is the difference from an event
subscriber, which runs best-effort in the request's process after the commit and is lost if
that process dies first.

**Ids and codes only.** A row stores the owner's `outboxData`, which is `audit-state.md`
list 1: ids, codes, booleans, counts, dates and field names. The table is platform-global, so
the bus refuses outbox data with a nested object or a string that is longer than a code or has
whitespace in it, naming the key and never the value. A handler re-reads anything else through
the owner's ports.

**Delivered at least once.** A worker drains the table: a BullMQ job scheduler ticks every
10 seconds, and a commit that wrote rows also enqueues one deduplicated wake-up, which the bus
does not wait for. If Redis is down at commit, the wake-up is lost and the row is not: the next
tick delivers it. Rows are claimed with `for update skip locked` under a five-minute lease, so
two worker processes never hand one row to two handlers at once. A lease that runs out is
reclaimed, so a handler can run twice: dedupe on `messageId`, which is the row's id and is
stable across retries.

**In the Organization's context.** Each row is delivered in a scope pinned to the
Organization it concerns (`single-org`, the system as actor), or in the drain's system scope
when it has none. The actor and request id recorded at commit arrive as `causation`, and the
request id is also the delivery scope's, so a Command the handler runs records the request that
caused it. The original actor's reach is never restored.

**Retries, then dead letters.** A failed delivery is retried after `min(30 s · 2^(n-1), 1 h)`,
up to 10 attempts, and the row is then dead. A handler throws `PermanentOutboxFailure(code,
message)` to dead-letter at once. A row stores the failure's code and the error's class, never
its message. A row whose handler module is switched off waits without spending an attempt, and
is delivered after the module is switched back on. A row whose module is present but no longer
registers the handler is dead-lettered `hook-unregistered`. Delivered rows are purged after 7
days, dead rows after 90. `module:uninstall --hard <module>` deletes that module's rows; a soft
uninstall keeps them.

Unlike `beforeCommit` hooks, `afterCommit` handlers on one action are not ordered against each
other — each is its own row, delivered on its own — and need no `commandHookOrder` entry. The
in-process `EventBus` and its subscribers are unchanged; the outbox is a second, durable path
for these handlers only.

## Reversibility & undo

A command may capture per-record before/after state so an operator can **undo** it.
The bulk product edit stores a `RevertRecord[]` on
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

`scripts/check-command-coverage.ts` statically flags, per method **and per route
handler**, in every `.ts` file under a root a module's source can live in — every module
package, the application tree and the overlay tree, derived by `resolveModuleLayout()` — a sensitive mutation
(`persist*`, `nativeUpdate`, `nativeDelete`, `remove*`, `flush`) that is neither audited
nor escape-hatched, and the **double-audit** shape (a unit that both runs a Command and
audits by hand). A unit counts as covered when it runs a Command, defines a Command
literal, records audit (`auditLog.record`/`recordWithin`, `recordAuditFromContext`, or a
`.audit` recorder), delegates to such a unit (`this.<runner>()`, a module-level helper, or
a function-valued local such as a route file's `const audit = …`), is itself a helper
invoked by a covered unit (reverse delegation), or carries a `command-coverage-ignore`
comment.

### What it opens

The walk used to match `**/services/<file>.ts` — one level, nothing else, which is **472
of the tree's 1152 module files**. `pim_ergonode/services/import/`,
`product_feeds/services/delivery/` and `services/queues/` were a level too deep;
`workers/`, `queues/`, `jobs/`, `commands/`, every `routes*.ts`, every `backend.ts` boot
hook, every `scripts/` entry point and every `seeds/` reconciler were outside it
altogether — which is to say the check read clean over queue consumers and admin route
handlers, the two places writes actually live. Widening it found ten unaudited
operator-visible writes (nine admin route handlers across seven modules, one federated
sign-in account creation).

Four exclusions remain, each an argument rather than an omission: `migrations/` (DDL with
no request and no actor), `*.test.ts` / `*.d.ts` (not shipped code) and `audit_logs/` (the
audit writer itself — requiring an audit of the audit is circular). `seeds/` and
`scripts/` are **in** scope and carry written escape hatches instead.

Two narrowings paid for the widening. `remove` counts as an ORM mutation only off an
EntityManager — 30 of the first-pass findings were `deps.<x>Service.remove(id)` in a route
handler, a call into an audited service — while the staleness half keeps counting it
everywhere. And a route file is judged **per handler**: read as one unit, a single
`commandBus.run` anywhere in it clears every other handler, which is the masking the
per-method rule exists to prevent, one level up.

The platform-wide rollout is **complete** — all backend modules are migrated (207
registered command actions, ~120 documented escape hatches). CI runs the check with
`--strict` in the `quality` stage, so **any** finding in **any** module — including a
brand-new module — fails the build. Coverage cannot silently regress.

### The escape hatch is swept for staleness

185 methods carry the ignore comment, and nothing used to re-read one: an
ignore written for a write that has since moved — into a Command, or into another
module's audited service — went on exempting a method that no longer needed exempting,
and the next write added there inherited the exemption in silence. A marker on a method
that **no longer writes at all** is now reported as `stale-ignore` and fails the build,
so the hatch is a two-way ratchet like every other ledger in the repository. Four were
found on the first run, all four in payment-gateway services whose local mirroring had
moved into `ReceivePaymentHandler`; their prose stayed as ordinary comments.

The staleness half deliberately looks for writes **more widely** than the flagging half —
it also counts a raw SQL write statement, a queue or Redis write (`removeJobScheduler`,
`obliterate`, `del`, …), an ambiguous `remove` off any receiver, and any write reached
through a call in the same file — so a marker guarding a real write the check cannot
itself see is left alone. Both errors then fall on the safe side: at worst a marker
outlives its write for one more refactor, never the reverse. Widening the scan had to
widen this half first: `product_feeds/workers/taxonomy-refresh-worker.ts`
documents its `queue.removeJobScheduler(…)` as "Redis-only", and a sweep that knew only
ORM and SQL would have demanded the deletion of a correct decision the moment `workers/`
came into scope.

A marker also has to be **on** the unit it exempts: inside the body, or in the doc comment
directly above it. Four command files describe their module's policy in a file header that
quotes the token, and reading a unit's full leading trivia let that header exempt whichever
declaration happened to come first — then, once the sweep landed, report it as a dead
marker nobody had written.

## Converting a write

For a Command: extract the pure write onto the transactional `em` and run it through
`commandBus.run(...)`; delete any prior manual audit call in the same change (avoid the
double-audit shape). For the lightweight path: add the `#audit(...)` helper delegating
to `recordAuditFromContext` and call it immediately before the method's `flush()`. For
a non-audited write: add a `command-coverage-ignore: <reason>` comment.

**There is no action to register anywhere.** Previously this paragraph ended with
*"register every new Command action in `backend/src/commands/command-registry.ts`"*, and
that file's own header named two consumers for the list — this check, and operator-facing
undo affordances. Both were wrong from the day it was written: `check-command-coverage.ts`
has never imported it and decides coverage from a `commandBus.run(...)` call in the same
method, and the one undo affordance in the tree reads the `reversible` **column** on
`catalog_bulk_operations`, set per row when the operation captured revert state.
`CommandBus.run` never consulted it and `Command.action` is a plain `string`. So a 258-entry
hand-maintained allow-list read as a gate and gated nothing, which is
worse than no list at all: the next author asking *"is this write covered?"* got a confident
wrong answer from it. It is deleted. **A Command's `action` is whatever string the Command
declares**; what makes the write audited is that it runs through `CommandBus.run`, and the
only thing that checks it is the check described above.
