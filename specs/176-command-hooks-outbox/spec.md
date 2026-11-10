# Feature Specification: Registration as one Command, `beforeCommit` command hooks, and a transactional outbox for `afterCommit` work

**Feature Branch**: `spec/176-command-hooks-outbox`
**Created**: 2026-11-10
**Status**: Draft. Scope accepted by the owner on 2026-11-10 in the instance-extensibility rulings:
OD-18 (registration becomes one Command), OD-7 (`beforeCommit` hooks on declared actions plus an
outbox-backed `afterCommit`), and OD-24 (hooks come early, right after registration becomes a
Command). The 2026-11-10 brief pulls the outbox **into** this feature. It is no longer deferred to a
later phase.
**Input**: "Registration becomes ONE Command. `beforeCommit` hooks on actions a module declares
hookable: same transaction, child commands via `ctx.run`, a hook can veto. `afterCommit` via a
transactional outbox table drained by a BullMQ worker. Hooks from a deactivated module are skipped."

Related work:
- `specs/177-tax-id-scope/` depends on **P1** of this feature. Its registration, create, set-parent
  and move changes sit on the registration Command, and its `organization.convert_to_company` is
  declared hookable through the API in `contracts/command-hooks-api.md`.
- `specs/178-extensible-columns/` depends on **P2**. Its instance hooks write `x_<module>_*` columns
  in the same transaction as the core row, through `extensions`, `currentCommandHookOrigin()` and
  `noteAuditChanges`. All three are defined here.
- Open PRs: #987 and #990 (both rewrite `registration-service.ts`; #990 also adds the Commands
  `organization.admin_patch` and `organization.set_custom_field_values`), and #1016
  (`customer_accounts` audit payloads, #470). The sequencing is in `plan.md` § *Delivery and
  sequencing*.
- Architect review §3(e) e3 and §7 (scratchpad `instance-extensibility-architect-review.md`, not in
  the tree) is the analysis this feature implements.

## Vocabulary

- **Command**: a named, audited write run through the Command Bus (Principle XIII). It writes
  exactly one audit entry and may run **child** Commands through `ctx.run`.
- **Hookable action**: a Command action that its **owning** module declares open to hooks, and for
  which phases. The declaration is part of the owner's published contract, as an audit action name
  already is.
- **`beforeCommit` hook**: code from another module that runs inside the Command's transaction,
  after the owner's write and before the commit. It may add its own writes, run child Commands, or
  **veto**, which rolls back the whole Command.
- **`afterCommit` handler**: code from another module that runs **after** the Command commits. It
  runs asynchronously and at least once, and it is delivered through the outbox.
- **Outbox**: a table the Command writes in the same transaction. A background worker reads it and
  delivers each row to its handler.
- **Hook module**: the module that registered a hook or handler. It can be a core module, a
  deployment overlay module, or an installed (instance) package.

## User Scenarios & Testing *(mandatory)*

### User Story 1: A registration either happens completely or not at all (Priority: P1)

A business registers on the storefront. Today the Organization row commits first and the first
user's account is created afterwards, in a separate unit of work. A failure in between leaves an
Organization with no administrator and no way to sign in: a duplicate e-mail race, a crash, or a
failing token insert. After this story, the Organization, its sales-channel binding, the first
account, the registry-lookup validation row and the e-mail verification token are written in one
transaction. Their audit entries and the `organization.registered.v1` event commit with them, or
none of these things happen.

**Why this priority**: this is a data-integrity defect that exists today, independently of
extensibility (OD-18), and it is the precondition for hooking registration. It merges alone.

**Independent Test**: inject a failure at each write step of a registration. For each one, assert
that no Organization, account, channel binding, validation row, token, audit entry or event exists
afterwards. Then run one clean registration and assert that it wrote everything, in one transaction.

**Acceptance Scenarios**:

1. **Given** an e-mail address that another registration inserts first (a race the pre-check cannot
   see), **When** a business registers with it, **Then** the answer is `409
   EMAIL_ALREADY_REGISTERED`, and no Organization row with the submitted tax ID exists.
2. **Given** a verification-token insert that fails, **When** a business registers, **Then** the
   answer is an error, and no Organization, account, channel binding, validation row or audit entry
   exists.
3. **Given** a clean registration, **When** it succeeds, **Then** the audit log holds exactly one
   `organization.register` entry and one `customer_account.create` entry. Both entries share one
   request id, and `organization.registered.v1` and `customer_account.created.v1` are each
   dispatched exactly once, after the commit.
4. **Given** any registration, **When** its audit entries are read, **Then** they carry names, codes
   and ids only. They never carry the organization name, tax ID, e-mail or address
   (`specs/conventions/audit-state.md`, O-2).
5. **Given** the public registration endpoint, **When** it is called with any input accepted before
   this feature, **Then** the response status, body shape and error codes are unchanged.

---

### User Story 2: An instance adds its own rule or data to a core write without forking (Priority: P1)

An instance developer ships an installed package that must take part in Organization writes. Three
examples: refuse a registration whose country the client does not serve, write the client's ERP
code into the instance's own columns in the same transaction as the new Organization (spec 178), or
create a related record of its own through that record's owner. The developer registers a
`beforeCommit` hook on `organization.register` (or `organization.create`, `organization.admin_patch`,
`organization.set_custom_field_values`), which the `organizations` module declares hookable. The
hook runs inside the write's transaction. If it refuses, nothing is written and the caller gets the
hook's typed error.

**Why this priority**: this is the only sanctioned way an instance can extend a core write. D-176 Q3
refuses decoration of a package's registrations, and in an instance every core module is a package.

**Independent Test**: compose a fixture module that hooks `organization.create`. Assert three
things: its write is visible in the same transaction and rolls back with the Command; its veto
answers its declared error code with no row written; and with the module switched off, the hook does
not run and the create succeeds.

**Acceptance Scenarios**:

1. **Given** a module with a `beforeCommit` hook on `organization.create` that writes a row of its
   own, **When** an operator creates an Organization, **Then** the Organization and the hook's row
   commit together, and one `organization.create` audit entry is written. Its after-state names the
   hook module's changed fields under `extensions.<moduleId>`.
2. **Given** that hook throws its module's declared refusal (`409 ACME_COUNTRY_NOT_SERVED`), **When**
   the create runs, **Then** the caller gets `409 ACME_COUNTRY_NOT_SERVED` with the hook module's
   translated message, and no Organization row, audit entry or event exists.
3. **Given** a hook that runs a child Command owned by another module through `ctx.run`, **When** the
   create succeeds, **Then** the child's own audit entry is written in the same transaction, and a
   failing child rolls the whole create back.
4. **Given** the hook module switched off by an operator, **When** the create runs, **Then** the hook
   does not run, and the create behaves exactly as if the module were not installed.
5. **Given** a module that registers a hook on an action no module declares hookable, or for a phase
   the owner does not offer, **When** the platform composes, **Then** composition fails. The error
   names the module, the hook id and the action.
6. **Given** two modules hooking the same action and phase with no dependency path between them and
   no deployment declaration ordering them, **When** the platform composes, **Then** composition
   fails, naming both modules and the action.
7. **Given** a caller that passes extension input for module `acme_erp` and no present hook of
   `acme_erp` on that action, **When** the Command runs, **Then** it is refused `422
   COMMAND_EXTENSION_UNCLAIMED`, naming the key, and nothing is written.

---

### User Story 3: Work after a write is delivered reliably, even across a crash (Priority: P2)

An instance must notify its ERP after an Organization is registered. An in-process event subscriber
is not enough: it runs best effort, after the commit, in the request's process. If that process dies
between the commit and the subscriber, the notification is lost. With an `afterCommit` handler on
`organization.register`, the platform writes one outbox row per present handler in the
registration's own transaction. A background worker delivers the row at least once, retries
failures with backoff, and dead-letters a row that keeps failing. The worker restores the tenant
context of the Organization the write concerned.

**Why this priority**: without the outbox, integration work after a core write has no delivery
guarantee. It builds on the hook registry from US 2.

**Independent Test**: commit a registration and kill the process before any handler runs. Start a
worker and assert that the handler runs exactly once per row (with the row's id as its idempotency
key), under a context pinned to the new Organization. Then make the handler fail and assert retries
with backoff, followed by dead-lettering.

**Acceptance Scenarios**:

1. **Given** an `afterCommit` handler on `organization.register`, **When** a registration commits,
   **Then** exactly one outbox row exists for that handler, written in the registration's
   transaction. It carries ids and codes only.
2. **Given** a registration that rolls back, **When** the outbox is read, **Then** it holds no row
   for it.
3. **Given** a committed outbox row, **When** the worker delivers it, **Then** the handler receives
   the row id as `messageId`, the declared data, and the recorded causation (actor and request id).
   It runs under a tenant context pinned to the row's Organization, and the row is marked delivered.
4. **Given** two worker processes, **When** they drain concurrently, **Then** no row is handed to
   two handlers at once.
5. **Given** a handler that throws, **When** the worker retries, **Then** each retry waits longer
   than the last. After the maximum number of attempts the row is dead-lettered, with an error code
   and class and no free text from the payload.
6. **Given** the handler's module switched off when its row is due, **When** the worker reaches the
   row, **Then** the row stays pending without consuming an attempt, and it is delivered after the
   module is switched back on.
7. **Given** a dead-lettered row, **When** an operator with the right permission retries it from the
   admin, **Then** it becomes pending again and the retry is audited.

---

### User Story 4: An operator can see which hooks run and what failed (Priority: P3)

A platform operator opens the *Command hooks* screen, from the platform area or with ⌘K/CTRL+K
"command hooks". The screen lists every registered hook and handler with its action, phase, module,
position and whether its module is on. It also lists outbox rows that are dead-lettered or overdue,
and offers a retry for each dead-lettered row.

**Why this priority**: a dead-letter queue that no one can see is silent loss. The screen is small
and read-mostly.

**Independent Test**: register a fixture hook and a failing handler. Assert that the list endpoint
returns them, that the screen renders them in both shipped languages, that retry requires the manage
permission, and that the palette action reaches the screen.

**Acceptance Scenarios**:

1. **Given** an admin holding `platform.modules.read`, **When** they open the screen, **Then** they
   see the hook execution plan per action.
2. **Given** an admin holding `platform.command_outbox.read`, **When** they filter by *dead*,
   **Then** they see each dead row's action, object id, hook module, attempts, error code and dates.
3. **Given** an admin without `platform.command_outbox.manage`, **When** they try to retry, **Then**
   they get `403`, and the retry control is not offered to them.

### Edge Cases

- **A hook runs a child Command whose action is itself hookable.** The child's hooks run too, inside
  the same transaction. If an action reappears in its own ancestor chain, the Command is refused
  (`500 COMMAND_HOOK_CYCLE`) before anything commits. Depth is bounded.
- **A hook writes another module's table directly.** This is forbidden (Principle I). A hook writes
  only its own module's tables, or runs the owner's Command through `ctx.run`. Spec 178 enforces it
  for S2 columns with `currentCommandHookOrigin()`. Everywhere else the rule is enforced in review.
- **A hook throws something that is not an `HttpError`.** The Command rolls back and the caller gets
  `500 INTERNAL`. This fails closed: a broken hook never lets a write through.
- **A hook's module is switched off between composition and the call.** The skip is decided per call
  from the effective state, so it stops running on the next Command.
- **A Command declared hookable does not supply its hook data.** The bus refuses the Command (`500`)
  in tests and in production. Every declared action has a test that proves it supplies the data.
- **The outbox handler's module is uninstalled.** Its pending rows stay. They are deleted by a
  `--hard` uninstall of that module, and by nothing else.
- **A handler id disappears from a present module after an upgrade.** Its rows are dead-lettered
  with `hook-unregistered`.
- **Redis is down when a Command commits.** The outbox row is in Postgres. The wake-up enqueue fails
  silently, and the next scheduled tick delivers the row.
- **A registration in an anonymous request.** It runs under the request's system tenant context, as
  today. Hooks run with system reach and a null actor, and handlers run pinned to the new
  Organization.
- **A reversible Command.** An owner must not declare a reversible Command's action hookable. Undo
  restores only what the owner captured, and it would leave hook writes behind.

## Requirements *(mandatory)*

### Functional Requirements

**P1: Registration as one Command (OD-18)**

- **FR-001**: Self-registration MUST run as one Command, `organization.register`, through the
  Command Bus. The Organization insert, its sales-channel binding, the first account, the
  registry-lookup validation row and the verification token MUST be written on the Command's one
  transaction.
- **FR-002**: The first account MUST be created by a **child** Command, `customer_account.create`,
  owned by `customer_accounts` and run through `ctx.run`. Its audit entry is written by the bus, in
  the parent's transaction.
- **FR-003**: Any failure after the first write MUST leave no Organization, account, channel binding,
  validation row, token, audit entry or event. This holds for a constraint violation, a child's
  refusal, a thrown error and an injected fault.
- **FR-004**: `customer_accounts`' existing `CustomerAccountMemberWritePort.create` MUST keep its
  contract. It MUST run the same `customer_account.create` Command, so the creation has one
  implementation. Its hand-written audit call MUST be removed in the same change (Principle XIII).
- **FR-005**: The password MUST be hashed **before** the registration's transaction opens. The
  argon2 cost MUST never run while the transaction holds the Organization row.
- **FR-006**: `organization.registered.v1` and `customer_account.created.v1` MUST be dispatched
  exactly once each, only after the commit, and never after a rollback.
- **FR-007**: `RegistrationService` MUST stop calling `recordAuditFromContext`. The
  `organization.register` audit state MUST follow `specs/conventions/audit-state.md` (O-2): codes,
  ids, booleans and `changedFields` / key names only.
- **FR-008**: The public `POST /api/v1/organizations/register` contract MUST be unchanged: request,
  response, status codes and error codes, including `409 ORGANIZATION_TAX_ID_EXISTS` from both the
  pre-check and the unique index.
- **FR-009**: Validation that does not write MUST stay outside the transaction, before the Command
  runs, so a slow dependency never holds the transaction open. This covers the country dictionary,
  the custom-field validation from #987 and the registry ticket read. The best-effort ticket deletion
  MUST run after the commit.

**P2: `beforeCommit` command hooks (OD-7, OD-24)**

- **FR-010**: A module MUST be able to declare, in its manifest, which of its Command actions are
  hookable and for which phases (`beforeCommit`, `afterCommit`). The declaration MUST come from a
  typed reference published in `@endora-commerce/contracts`, so one constant serves both the manifest
  and every hook author.
- **FR-011**: A module MUST be able to register hooks through its `ModuleContext`
  (`ctx.commandHooks([...])`), each with a module-unique id, a hookable-action reference, a phase and
  a handler. The platform stamps the registering module's id, never the module itself.
- **FR-012**: Composition MUST fail for any of these:
  - a hook on an action no composed module declares hookable;
  - a hook for a phase the owner does not offer;
  - an action declared hookable by two modules;
  - a duplicate `(module, id)`;
  - a hook module whose manifest `dependencies` do not reach the owning module;
  - two hook modules on one action and phase with no dependency path between them and no deployment
    declaration ordering them.
  Each failure MUST name the modules, the hook id and the action.
- **FR-013**: The order of `beforeCommit` hooks on one action MUST be derived from the manifest
  dependency graph: a module's hooks run after the hooks of every module it transitively depends on.
  Hooks of one module run in registration order. The order MUST be deterministic, and identical
  inputs MUST give an identical order (Principle XV).
- **FR-014**: A deployment MUST be able to order two hook modules that have no dependency path
  between them, in its own `divergence.ts` (`commandHookOrder`). The composer MUST refuse a
  declaration that contradicts a dependency path. *(Recommendation for OD-1 in `plan.md`; FR-012's
  refusal stands if the owner rules otherwise.)*
- **FR-015**: `beforeCommit` hooks MUST run inside the Command's transaction, after the owner's `run`
  returns and before the owner's audit entry is recorded. They run on the same tenant-scoped
  `EntityManager` and with the same actor, and they MUST be able to run child Commands through
  `ctx.run` with the existing child semantics (own audit entry, same transaction).
- **FR-016**: A hook MUST be able to veto by throwing an `HttpError` whose code its own module
  declares and translates. The Command MUST roll back, and the caller MUST receive that status, code
  and details unchanged. Any other thrown value MUST roll back the Command and answer `500`.
- **FR-017**: A hook whose module is not present on the effective state (Principle XVII, either axis)
  MUST be skipped for that call. The Command MUST behave exactly as if the module were not installed.
- **FR-018**: A hook MUST receive the owner's declared hook data for the action, typed by the
  contract reference, and its own module's slice of the caller's extension input
  (`extensions[<moduleId>]`).
- **FR-019**: A Command whose `extensions` carry a key that no present hook module on that action
  claims MUST be refused `422 COMMAND_EXTENSION_UNCLAIMED` before any write.
- **FR-020**: A hook that writes its own module's tables directly MUST be able to name what it
  changed (`ctx.noteAuditChanges(fields)`). The owner's single audit entry MUST then carry
  `extensions.<moduleId>.changedFields` in its after-state, never the values.
- **FR-021**: While a hook runs, the platform MUST expose the hook's origin (module id, hook id,
  action) to code on the same async path (`currentCommandHookOrigin()`), so an owner-side accessor
  can assert which module is writing. Spec 178 needs this.
- **FR-022**: A hookable action reappearing in its own ancestor chain MUST be refused, and
  hook-induced Command nesting MUST be bounded in depth.
- **FR-023**: A Command whose action is declared hookable MUST supply its hook data (and, for
  `afterCommit`, its outbox data). One that does not MUST be refused.
- **FR-024**: `organizations` MUST declare `organization.create`, `organization.register`,
  `organization.admin_patch` and `organization.set_custom_field_values` hookable for both phases,
  with the data shapes in `contracts/organization-hookable-actions.md`. The last two exist only once
  #990 merges (OD-3).
- **FR-025**: An installed package in an instance MUST be able to register hooks on another
  package's declared actions. The instance acceptance probe MUST prove it.
- **FR-026**: Hooks MUST appear in the deployment's divergence report as a new kind, `command-hook`,
  and in a read-only execution-plan endpoint.

**P3: `afterCommit` through a transactional outbox (OD-7)**

- **FR-030**: For each present `afterCommit` handler on a hookable action, a committed Command MUST
  have written exactly one outbox row **in its own transaction**. A rolled-back Command MUST have
  written none.
- **FR-031**: An outbox row's data MUST be the owner's declared outbox data, limited to
  `audit-state.md` list 1 (ids, codes, booleans, counts, dates, field names). It MUST never hold free
  text, money, personal data or custom-field values.
- **FR-032**: A background worker MUST deliver every pending row at least once. It MUST claim rows
  atomically (`for update skip locked` with a lease), so no two consumers run the same row
  concurrently, and it MUST hand the row id to the handler as the idempotency key (`messageId`).
- **FR-033**: The worker MUST follow Principle X and the `quote_requests` sweep pattern: BullMQ as
  the clock (a job scheduler plus a deduplicated wake-up job enqueued after a commit that wrote rows),
  a separable worker entrypoint, and nothing run inside the request path.
- **FR-034**: The handler MUST run under a tenant context pinned to the row's Organization when the
  row has one, and under the system scope otherwise. The recorded actor and request id MUST be
  available to it. The handler's own Commands MUST carry the original request id on their audit
  entries.
- **FR-035**: A failed delivery MUST be retried with increasing backoff, up to a fixed number of
  attempts. After that the row MUST be dead-lettered with the error's code and class, never its free
  text. A handler MAY throw a permanent-failure error, which dead-letters the row at once.
- **FR-036**: A row whose handler module is not present MUST stay pending without consuming an
  attempt. A row whose handler is no longer registered in a present module MUST be dead-lettered
  `hook-unregistered`. A `--hard` uninstall of a module MUST delete that module's rows.
- **FR-037**: Delivered rows MUST be purged after a fixed retention. Dead rows MUST be kept until they
  are retried or purged.
- **FR-038**: The existing in-process `EventBus` and every existing subscriber MUST remain unchanged.
  The outbox is a second, durable path for `afterCommit` handlers only. No subscriber migrates in
  this feature.

**P4: Operator surface, documentation, governance**

- **FR-040**: The platform MUST serve the execution plan (`GET /api/v1/admin/command-hooks`, behind
  `platform.modules.read`). It MUST also serve outbox rows filtered by status
  (`GET /api/v1/admin/command-outbox`, behind the new permission `platform.command_outbox.read`) and
  a retry (`POST /api/v1/admin/command-outbox/:id/retry`, behind `platform.command_outbox.manage`).
  The retry MUST run as the audited Command `command_outbox.retry`.
- **FR-041**: The two new permissions MUST be registered in the `_lifecycle` manifest and labelled in
  pl and en. A ⌘K action MUST reach the *Command hooks* screen, and every string on the screen MUST
  ship in pl and en.
- **FR-042**: The constitution's Principle XIII MUST be amended to say that a transactional outbox
  for post-commit delivery is durable event dispatch, not a "bespoke command queue". Principle XV's
  overridable-surface list MUST name declared command hooks.
- **FR-043**: `docs/docs/architecture/customisation-ladder.md` MUST gain the command-hook seam (and
  drop *"There is no handler registry and nothing to hook"*). `command-bus.md` and the `organizations`
  module page MUST document hookable actions and the outbox, in English and Polish.

### Key Entities

- **Hookable action declaration**: an owner module's statement that one of its Command actions
  accepts hooks, and for which phases. It is published as a typed reference.
- **Command hook registration**: one hook or handler: the hook module, an id, the action, the phase
  and the handler. Its position is derived from the dependency graph.
- **Outbox row**: one pending, delivered or dead delivery of one Command execution to one
  `afterCommit` handler. It carries the action, the object, the Organization it concerns, data limited
  to ids and codes, the recorded causation, attempts and timing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every write step of registration, an injected fault leaves zero rows of any kind
  behind, measured by an integration test per step.
- **SC-002**: A hook's veto reaches the caller with its own status and code in every case tested,
  and zero rows are written.
- **SC-003**: With two consumers and a set of committed rows, every row is delivered, and zero rows
  are handed to two handlers concurrently.
- **SC-004**: A process killed between commit and delivery loses zero `afterCommit` deliveries.
- **SC-005**: With a hook module switched off, the hooked Command's responses and writes equal those
  of a composition without that module (an off-state test).
- **SC-006**: Every functional requirement above traces to at least one test in `tasks.md`.

## Assumptions

- `organizations` and `customer_accounts` are both `nonDeactivatable`, so the owner side of XVII
  cannot be reached for the first hookable actions.
- An anonymous request carries the platform's system tenant context (`actor-tenant-context.ts`), so
  the registration Command resolves an actor as `admin_patch`'s subscribers already do (#990).
- PR #997 is merged (#1013). The bus reads request metadata from the ambient platform scope, so the
  registration's entries carry the request id. This feature builds on it.
- The outbox's volume is the volume of hooked writes, low in the first release. The worker may be
  co-located in the `BACKEND_ROLE=all` process (Principle X's low-volume posture) because it stays a
  separable entrypoint.
- Personal-organization provisioning (`personal-organization-service.ts`) is not a Command today and
  is **not** declared hookable here (see `research.md` R-14). Spec 177 owns that service's next
  change.
